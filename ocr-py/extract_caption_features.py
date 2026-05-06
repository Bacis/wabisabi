#!/usr/bin/env python3
"""
Extract per-frame caption visual features from a video using EasyOCR.

For each sampled frame, detects text regions, then for each detection records:
  - bbox (top-left x, y, width, height in pixels)
  - text (recognized string, lowercased)
  - confidence (0..1)
  - color (median RGB of "text-like" pixels inside the bbox)
  - font_height (bbox height; rough size proxy)
  - position_y (bbox center y / frame height)
  - position_x (bbox center x / frame width)

Output JSON shape:
  {
    "video_width": int, "video_height": int, "fps": float,
    "duration_sec": float, "sample_fps": float,
    "frames": [
      {
        "t": float (seconds),
        "detections": [
          {"bbox": [x,y,w,h], "text": str, "conf": float,
           "color": [r,g,b], "color_hex": "#rrggbb",
           "font_height": int,
           "pos_x": float, "pos_y": float,
           "case": "upper"|"lower"|"mixed"}
        ]
      }
    ]
  }

Usage:
  python extract_caption_features.py <video> <out.json> [--fps 5]
"""

import sys
import os
import json
import math
import argparse
import numpy as np
import cv2

# Lazy import easyocr — first call downloads model weights.
def _load_reader():
    import easyocr
    return easyocr.Reader(['en'], gpu=False, verbose=False)


def median_text_color(crop_bgr: np.ndarray,
                      polygon: np.ndarray | None = None) -> tuple[int, int, int]:
    """
    Pick the dominant text color from a cropped bbox using histogram-mode
    finding in HSV space. This is robust to:
      - White text near red/yellow background highlights (mode of glyph
        pixels dominates over scattered highlights).
      - Red text on dim/varied backgrounds (red glyphs cluster tightly).
      - Yellow text near other bright pixels.

    Optional polygon (in crop-relative coords) tightens the sample to the
    EasyOCR text polygon — usually a parallelogram more conservative than the
    bbox.

    Algorithm:
      1. Optionally mask by polygon to drop padding pixels.
      2. Discard near-black pixels (V < 60) — those are almost always
         background or text outline, never the glyph fill.
      3. Quantize remaining pixels to 16x16x16 RGB bins and find the most-
         populated bin. Glyph pixels (uniform color) collapse into one bin;
         scattered background pixels spread across many.
      4. Return the mean of pixels in that bin (gives sub-bin precision).

    Returns RGB tuple.
    """
    if crop_bgr.size == 0:
        return (255, 255, 255)

    # Build sample mask
    h, w = crop_bgr.shape[:2]
    sample_mask = np.ones((h, w), dtype=bool)
    if polygon is not None and len(polygon) >= 3:
        poly_mask = np.zeros((h, w), dtype=np.uint8)
        try:
            cv2.fillPoly(poly_mask, [polygon.astype(np.int32)], 255)
            sample_mask &= (poly_mask > 0)
        except cv2.error:
            pass

    # Discard very dark pixels — text never lives there.
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    V = hsv[:, :, 2]
    sample_mask &= V > 60

    pixels = crop_bgr[sample_mask]
    if pixels.shape[0] < 8:
        # Fallback: use everything but very dark pixels in the raw crop.
        pixels = crop_bgr.reshape(-1, 3)
        pixels = pixels[pixels.sum(axis=1) > 60]
        if pixels.shape[0] == 0:
            return (255, 255, 255)

    # Histogram mode: 16 bins per channel. quant = pix >> 4 gives 0..15.
    BINS = 16
    quant = (pixels.astype(np.uint8) >> 4)
    keys = (quant[:, 0].astype(np.int32) * BINS * BINS
            + quant[:, 1].astype(np.int32) * BINS
            + quant[:, 2].astype(np.int32))
    counts = np.bincount(keys, minlength=BINS * BINS * BINS)
    top_bin = int(np.argmax(counts))
    if counts[top_bin] == 0:
        return (255, 255, 255)

    # Recover the centroid of pixels in the dominant bin.
    bin_pixels = pixels[keys == top_bin]
    mean = bin_pixels.mean(axis=0).astype(int)
    return (int(mean[2]), int(mean[1]), int(mean[0]))


def detect_italic(crop_bgr: np.ndarray,
                  polygon: np.ndarray | None = None) -> bool:
    """
    Detect if the text in the crop is italic by finding the shear angle
    that maximizes vertical-stroke alignment.

    Method: italic glyphs have vertical strokes tilted at ~7-15° from
    vertical. Shearing the image horizontally by the right angle "de-italicizes"
    the strokes, making them perfectly vertical. We sweep shear angles from
    -15° to +15° and measure how "stripey" the resulting column-sum projection
    is — peak variance == strokes are aligned to columns. If the peak is at
    a non-zero shear, the original text was italic by that amount.

    Returns True if the optimal de-shear is > ±5° (clear italic lean).
    """
    if crop_bgr.size == 0:
        return False
    h, w = crop_bgr.shape[:2]
    if h < 30 or w < 30:
        return False

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    # Threshold to text-vs-background
    try:
        _, binary = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU,
        )
    except cv2.error:
        return False
    # Ensure foreground (glyph) is white. Most reels have light text, so the
    # OTSU threshold splits at a midpoint. Whichever side has fewer pixels is
    # almost always the text.
    fg_count = (binary > 128).sum()
    bg_count = binary.size - fg_count
    if fg_count > bg_count:
        binary = 255 - binary

    if polygon is not None and len(polygon) >= 3:
        poly_mask = np.zeros((h, w), dtype=np.uint8)
        try:
            cv2.fillPoly(poly_mask, [polygon.astype(np.int32)], 255)
            binary = cv2.bitwise_and(binary, poly_mask)
        except cv2.error:
            pass

    if binary.sum() / 255 < 60:
        return False  # not enough glyph pixels

    # Sweep shear angles and find the one with highest column-sum variance.
    best_angle = 0
    best_var = -1.0
    out_w = w + int(h * math.tan(math.radians(20)))
    for angle in range(-14, 15, 2):
        rad = math.radians(angle)
        M = np.array([[1, math.tan(rad), 0], [0, 1, 0]], dtype=np.float32)
        sheared = cv2.warpAffine(binary, M, (out_w, h),
                                 flags=cv2.INTER_NEAREST,
                                 borderValue=0)
        col_sums = sheared.sum(axis=0)
        # Drop empty columns to focus on the textured stretch
        col_sums = col_sums[col_sums > 0]
        if col_sums.size < 20:
            continue
        var = float(col_sums.var())
        if var > best_var:
            best_var = var
            best_angle = angle

    return abs(best_angle) >= 6


def detect_case(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 'none'
    upper = sum(1 for c in letters if c.isupper())
    if upper == len(letters):
        return 'upper'
    if upper == 0:
        return 'lower'
    return 'mixed'


def process_video(video_path: str, out_path: str, sample_fps: float = 5.0,
                  min_conf: float = 0.4) -> None:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f'Could not open video: {video_path}')

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / src_fps if src_fps else 0.0

    frame_step = max(1, int(round(src_fps / sample_fps)))
    print(f'[ocr] video {width}x{height} {src_fps:.1f}fps, {total_frames} frames, '
          f'{duration:.1f}s; sampling every {frame_step} frames '
          f'(~{src_fps/frame_step:.1f}fps)', file=sys.stderr)

    print('[ocr] loading easyocr reader (first run downloads weights)...',
          file=sys.stderr)
    reader = _load_reader()
    print('[ocr] ready', file=sys.stderr)

    frames_out = []
    frame_idx = 0
    sampled = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % frame_step != 0:
            frame_idx += 1
            continue

        t_sec = frame_idx / src_fps
        # EasyOCR expects RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        try:
            results = reader.readtext(rgb, detail=1, paragraph=False)
        except Exception as e:
            print(f'[ocr] frame {frame_idx} failed: {e}', file=sys.stderr)
            results = []

        detections = []
        for entry in results:
            poly, text, conf = entry[0], entry[1], float(entry[2])
            if conf < min_conf or not text.strip():
                continue
            # Drop OCR misreads / watermark detections. Real reel captions
            # never contain these chars (=, _, ~, |, ^, `, \, /, <, >) — when
            # OCR returns them it's almost always reading a logo, watermark,
            # or non-text artifact in the frame.
            cleaned = text.strip()
            if any(c in cleaned for c in '=_~|^`\\<>{}[]'):
                continue
            alpha_count = sum(1 for c in cleaned if c.isalpha())
            digit_count = sum(1 for c in cleaned if c.isdigit())
            # Token must have at least 2 alpha chars OR be a pure number
            # (numbers like "26", "30" are legitimate emphasis words in reels).
            if alpha_count < 2 and digit_count == 0:
                continue
            # Drop very short non-numeric tokens — usually OCR noise from
            # background detail (single letters like "G", "B", "h").
            if alpha_count + digit_count <= 2 and digit_count == 0:
                # Allow common 2-letter words that DO appear in captions.
                if cleaned.lower() not in {'no', 'is', 'it', 'us', 'my', 'we',
                                            'or', 'so', 'if', 'on', 'in',
                                            'as', 'at', 'an', 'be', 'by',
                                            'do', 'go', 'me', 'of', 'to',
                                            'up', 'i', 'a', 'oh', 'yo'}:
                    continue

            xs = [int(p[0]) for p in poly]
            ys = [int(p[1]) for p in poly]
            x0, y0 = max(0, min(xs)), max(0, min(ys))
            x1, y1 = min(width, max(xs)), min(height, max(ys))
            w, h = x1 - x0, y1 - y0
            if w <= 2 or h <= 2 or h < 40:
                continue
            crop = frame[y0:y1, x0:x1]
            # Translate polygon to crop-relative coords
            poly_rel = np.array(
                [[float(p[0]) - x0, float(p[1]) - y0] for p in poly],
                dtype=np.float32,
            )
            r, g, b = median_text_color(crop, poly_rel)
            # Drop detections whose dominant color is too dark — real reel
            # captions are always rendered bright (white/yellow/red, max
            # channel > 130 minimum). Dark text inside the bbox is almost
            # always background graphics, clothing logos, signs, scene text,
            # not a caption.
            v_max = max(r, g, b)
            if v_max < 130:
                continue
            color_hex = f'#{r:02x}{g:02x}{b:02x}'
            italic = detect_italic(crop, poly_rel)
            detections.append({
                'bbox': [x0, y0, w, h],
                'text': text.strip(),
                'conf': round(conf, 3),
                'color': [r, g, b],
                'color_hex': color_hex,
                'font_height': h,
                'font_width': w,
                'pos_x': round((x0 + w / 2) / width, 4),
                'pos_y': round((y0 + h / 2) / height, 4),
                'case': detect_case(text),
                'italic': italic,
            })
        frames_out.append({'t': round(t_sec, 3), 'detections': detections})
        sampled += 1
        if sampled % 10 == 0:
            print(f'[ocr] {sampled} frames processed (t={t_sec:.1f}s)',
                  file=sys.stderr)
        frame_idx += 1

    cap.release()

    out = {
        'video_width': width,
        'video_height': height,
        'fps': src_fps,
        'duration_sec': duration,
        'sample_fps': src_fps / frame_step if frame_step else src_fps,
        'frames': frames_out,
    }
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    total_dets = sum(len(f['detections']) for f in frames_out)
    print(f'[ocr] done: {sampled} frames, {total_dets} detections -> {out_path}',
          file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('out_json')
    ap.add_argument('--fps', type=float, default=5.0,
                    help='frames per second to sample (default 5)')
    ap.add_argument('--min-conf', type=float, default=0.4,
                    help='discard detections below this OCR confidence')
    args = ap.parse_args()
    process_video(args.video, args.out_json, args.fps, args.min_conf)


if __name__ == '__main__':
    main()
