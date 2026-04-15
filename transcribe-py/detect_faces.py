#!/usr/bin/env python3
"""Sample-based face detection using MediaPipe Tasks API.

Outputs JSON with normalized face bounding boxes per sampled frame to a path
passed as the second arg. Same protocol as transcribe.py — output goes to a
file (not stdout) so the protocol can't be corrupted by any library writing
to stdout. All logs go to stderr.

The MediaPipe Tasks API requires an explicit .tflite model file. We auto-
download blaze_face_short_range.tflite (~250KB) from Google's CDN on first
use and cache it under ~/.cache/captions/.

Usage: detect_faces.py <video> <output.json>

Environment:
  FACE_SAMPLE_FPS  Frames per second to sample (default: 4)
  FACE_MODEL_PATH  Override path to blaze_face_short_range.tflite
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path


MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
DEFAULT_MODEL_DIR = Path.home() / ".cache" / "captions"
MODEL_FILENAME = "blaze_face_short_range.tflite"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def ensure_model() -> str:
    """Return a path to the face detection model, downloading it if needed."""
    custom = os.environ.get("FACE_MODEL_PATH")
    if custom:
        path = Path(custom)
        if path.exists():
            return str(path)
        target = path
    else:
        target = DEFAULT_MODEL_DIR / MODEL_FILENAME
        if target.exists():
            return str(target)

    target.parent.mkdir(parents=True, exist_ok=True)
    log(f"downloading face model to {target}...")
    urllib.request.urlretrieve(MODEL_URL, str(target))
    log("face model downloaded")
    return str(target)


def main() -> None:
    if len(sys.argv) != 3:
        log("usage: detect_faces.py <video> <output.json>")
        sys.exit(2)
    video_path = sys.argv[1]
    output_path = sys.argv[2]

    sample_fps = float(os.environ.get("FACE_SAMPLE_FPS", "4"))

    # Lazy imports — give a real error if a dep is missing instead of crashing
    # before we can log anything useful.
    import cv2
    import mediapipe as mp

    model_path = ensure_model()

    BaseOptions = mp.tasks.BaseOptions
    FaceDetector = mp.tasks.vision.FaceDetector
    FaceDetectorOptions = mp.tasks.vision.FaceDetectorOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    options = FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=VisionRunningMode.IMAGE,
        min_detection_confidence=0.5,
    )
    detector = FaceDetector.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        log(f"could not open {video_path}")
        sys.exit(3)

    src_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / src_fps if src_fps > 0 else 0.0
    log(f"video: {width}x{height} {src_fps:.2f}fps {total_frames}f {duration:.2f}s")

    stride = max(1, int(round(src_fps / sample_fps))) if src_fps > 0 else 1
    log(f"sampling every {stride} frames (~{src_fps/stride:.1f} sample fps)")

    samples = []
    detected = 0
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % stride == 0:
            t = frame_idx / src_fps if src_fps > 0 else 0.0
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = detector.detect(mp_image)
            faces = []
            for det in result.detections:
                # The Tasks API returns PIXEL coordinates — normalize to [0,1]
                # so the layout engine can resolve them to any frame size.
                bbox = det.bounding_box
                x = max(0.0, bbox.origin_x / width)
                y = max(0.0, bbox.origin_y / height)
                w = min(1.0 - x, max(0.0, bbox.width / width))
                h = min(1.0 - y, max(0.0, bbox.height / height))
                score = (
                    float(det.categories[0].score)
                    if det.categories
                    else 0.0
                )
                faces.append(
                    {
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                        "score": score,
                    }
                )
            if faces:
                detected += 1
            samples.append({"time": t, "faces": faces})
        frame_idx += 1

    cap.release()
    detector.close()

    log(f"sampled {len(samples)} frames, {detected} contained faces")

    out = {
        "videoWidth": width,
        "videoHeight": height,
        "videoFps": src_fps,
        "videoDuration": duration,
        "samples": samples,
    }
    with open(output_path, "w") as f:
        json.dump(out, f)
    log(f"done -> {output_path}")


if __name__ == "__main__":
    main()
