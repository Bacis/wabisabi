import cv2
import mediapipe as mp
import numpy as np
import os
import shutil
import subprocess
import logging
import random
import re
import textwrap
from PIL import Image, ImageDraw, ImageFont

import json
from pathlib import Path
from playwright.sync_api import sync_playwright

def parse_stroke(stroke_str, f_size):
    if not stroke_str or stroke_str == "none" or stroke_str == "null":
        return 0, None
    match = re.search(r'(\d+)px\s+(#?[a-zA-Z0-9]+)', stroke_str.strip())
    if match:
        orig_w = int(match.group(1))
        scaled_w = max(1, int(f_size * (orig_w / 150.0)))
        return scaled_w, match.group(2)
    return 0, None

def parse_shadows(shadow_str, f_size):
    if not shadow_str or shadow_str == "none" or shadow_str == "null":
        return []
    shadows = []
    pattern = r'(-?\d+)px\s+(-?\d+)px\s+(?:-?\d+px\s+)?(#?[a-zA-Z0-9]+)'
    for piece in shadow_str.split(','):
        match = re.search(pattern, piece.strip())
        if match:
            orig_x = int(match.group(1))
            orig_y = int(match.group(2))
            
            # assume css was designed for ~150px
            scaled_x = int(f_size * (orig_x / 150.0))
            scaled_y = int(f_size * (orig_y / 150.0))
            
            if orig_x != 0 and scaled_x == 0: scaled_x = 1 if orig_x > 0 else -1
            if orig_y != 0 and scaled_y == 0: scaled_y = 1 if orig_y > 0 else -1
            
            shadows.append({
                "x": scaled_x,
                "y": scaled_y,
                "color": match.group(3)
            })
    return shadows

def render_project_native(input_video_path: str, transcript_words: list, segments: list, style_config: dict, output_path: str):
    logging.info(f"Starting Native Render for {input_video_path}")
    logging.info(f"DEBUG style_config keys: {style_config.keys() if style_config else 'None'}")
    logging.info(f"DEBUG first segment: {segments[0] if segments else 'None'}")
    
    cap = cv2.VideoCapture(input_video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    if fps <= 0: fps = 30
    
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tflite_path = os.path.join(backend_dir, "..", "experiments", "backend-text-behind-video", "selfie_segmenter.tflite")
    tflite_path = os.path.abspath(tflite_path)

    base_options = python.BaseOptions(model_asset_path=tflite_path)
    options = vision.ImageSegmenterOptions(
        base_options=base_options,
        output_category_mask=True
    )
    segmenter = vision.ImageSegmenter.create_from_options(options)
    
    tmp_mask_vid = f"tmp_mask_{random.randint(1000, 9999)}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(tmp_mask_vid, fourcc, fps, (width, height))
    
    tmp_frames_dir = f"tmp_frames_{random.randint(1000, 9999)}"
    os.makedirs(tmp_frames_dir, exist_ok=True)
    
    frame_idx = 0
    black_mask = np.zeros((height, width, 3), dtype=np.uint8)
    page_zone_cache = {}

    def get_active_segment(current_time):
        for seg in segments:
            if seg["start_time"] <= current_time <= seg["end_time"]:
                return seg
        return None

    # Compile frames state to pass to headless chromium later
    frame_playwright_states = []

    logging.info("Iterating frames...")
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
            
        frame_idx += 1
        current_time_sec = frame_idx / fps
        
        active_segment = get_active_segment(current_time_sec)
        segment_mode = active_segment.get("caption_mode") if active_segment else "standard"
        
        # Mask Generation
        if segment_mode == "text_behind_subject":
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            segmentation_result = segmenter.segment(mp_image)
            mask_view = segmentation_result.category_mask.numpy_view()
            mask_view = np.squeeze(mask_view) 
            binary_mask = np.where(mask_view == 0, 255, 0).astype(np.uint8)
            mask_bgr = cv2.cvtColor(binary_mask, cv2.COLOR_GRAY2BGR)
            writer.write(mask_bgr)
        else:
            writer.write(black_mask)

        if active_segment:
            segment_words = [w for w in transcript_words if active_segment["start_time"] <= w["start"] <= active_segment["end_time"]]
            
            if segment_words:
                pages = [segment_words[i:i+4] for i in range(0, len(segment_words), 4)]
                active_page = pages[0]
                for p in pages:
                    if current_time_sec >= p[0]["start"] - 0.1:
                        active_page = p
                
                base_style_key = active_segment.get("style", "style_basic_white") if active_segment else "style_basic_white"
                available_styles = [k for k in style_config.keys() if k.startswith('style_')] if style_config else []
                missing_styles = [s for s in available_styles if s != base_style_key]
                
                word_styles = [base_style_key] * len(active_page)
                if len(available_styles) > 1 and len(missing_styles) > 0 and len(active_page) > 0:
                    seed_base = int(active_page[0]["start"] * 100)
                    available_indices = list(range(len(active_page)))
                    available_indices.sort(key=lambda x: (np.sin(seed_base + x) * 10000 % 1))
                    
                    for i, ms in enumerate(missing_styles):
                        if i < len(available_indices):
                            target_idx = available_indices[i]
                            word_styles[target_idx] = ms
                
                # Active page box config
                active_page_id = str(active_page[0]["start"])
                if active_page_id not in page_zone_cache and segment_mode == "text_behind_subject":
                    coords = cv2.findNonZero((binary_mask == 0).astype(np.uint8))
                    if coords is not None:
                        x, y, w_box, h_box = cv2.boundingRect(coords)
                        px_min, py_min, px_max, py_max = x, y, x + w_box, y + h_box
                    else:
                        px_min, py_min, px_max, py_max = 0, height, 0, height
                        
                    zones = {
                        "top": {"x": 0, "y": 0, "w": width, "h": py_min},
                        "left": {"x": 0, "y": 0, "w": px_min, "h": height},
                        "right": {"x": px_max, "y": 0, "w": width - px_max, "h": height}
                    }
                    
                    best_zone = max(zones.values(), key=lambda z: z["w"] * z["h"])
                    
                    pad_x = int(width * 0.05)
                    pad_y = int(height * 0.05)
                    
                    bz_x = best_zone["x"] + pad_x
                    bz_y = best_zone["y"] + pad_y
                    bz_w = best_zone["w"] - (pad_x * 2)
                    bz_h = best_zone["h"] - (pad_y * 2)
                    
                    if bz_w < width * 0.3 or bz_h < height * 0.2:
                        bz_x = pad_x
                        bz_y = pad_y
                        bz_w = width - (pad_x * 2)
                        bz_h = height - (pad_y * 2)
                        
                    page_zone_cache[active_page_id] = {"x": bz_x, "y": bz_y, "w": bz_w, "h": bz_h, "f_size": int(height * 0.15)}

                padding_x = int(width * 0.05)
                max_w_default = width - (2 * padding_x)
                
                # Prepare JSON State
                words_payload = []
                for idx, w_dict in enumerate(active_page):
                    w_style = style_config.get(word_styles[idx], {})
                    is_visible = current_time_sec >= w_dict["start"]
                    words_payload.append({
                        "text": w_dict["word"].strip(),
                        "visible": is_visible,
                        "style": w_style
                    })
                
                if segment_mode == "text_behind_subject":
                    safe_zone = page_zone_cache[active_page_id]
                    layout_payload = {
                        "x": safe_zone["x"],
                        "y": safe_zone["y"],
                        "w": safe_zone["w"],
                        "h": safe_zone["h"],
                        "f_size": safe_zone["f_size"],
                        "align": "center"
                    }
                else:
                    approx_h = int(height * 0.3)
                    layout_payload = {
                        "x": padding_x,
                        "y": int(height * 0.85) - approx_h,
                        "w": max_w_default,
                        "h": approx_h,
                        "f_size": int(width * 0.08),
                        "align": "center"
                    }
                
                state_obj = {
                    "words": words_payload,
                    "layout": layout_payload
                }
                
                frame_playwright_states.append({
                    "frame_idx": frame_idx,
                    "state": state_obj
                })
        
        # We don't save frame_canvas natively anymore, we'll let Playwright render it out-of-loop.

    cap.release()
    writer.release()
    segmenter.close()

    logging.info(f"Rendering {len(frame_playwright_states)} active text frames using Playwright Chromium...")
    
    # Generate transparent overlays explicitly only on frames with active state
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tpl_path = Path(backend_dir) / "app" / "services" / "templates" / "caption_engine.html"
    
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto(f"file://{tpl_path.absolute()}")
        
        last_state_json = ""
        for frame_idx in range(1, frame_idx + 1):
            frame_path = os.path.join(tmp_frames_dir, f"frame_{frame_idx:04d}.png")
            
            # Find state for this frame
            frame_state = next((fs for fs in frame_playwright_states if fs["frame_idx"] == frame_idx), None)
            
            if frame_state:
                current_state_json = json.dumps(frame_state["state"])
                if current_state_json != last_state_json:
                    page.evaluate("async (s) => await window.renderState(s)", frame_state["state"])
                    last_state_json = current_state_json
                    
                page.screenshot(path=frame_path, omit_background=True)
            else:
                # Blank frame payload
                blank_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                blank_img.save(frame_path)
                
        browser.close()

    logging.info("Hardware Compositing natively with FFmpeg...")
    cmd = [
        "ffmpeg", "-y",
        "-i", input_video_path,
        "-framerate", str(fps),
        "-i", f"{tmp_frames_dir}/frame_%04d.png",
        "-i", input_video_path,
        "-i", tmp_mask_vid,
        "-filter_complex", 
        "[2:v][3:v]alphamerge[person_cutout];"
        "[0:v][1:v]overlay=0:0[bg_with_text];"
        "[bg_with_text][person_cutout]overlay=0:0,format=yuv420p[vout]",
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-color_primaries", "bt2020",
        "-color_trc", "arib-std-b67",
        "-colorspace", "bt2020nc",
        "-c:a", "copy",
        "-shortest", output_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if os.path.exists(tmp_mask_vid): os.remove(tmp_mask_vid)
    if os.path.exists(tmp_frames_dir): shutil.rmtree(tmp_frames_dir)
    logging.info(f"Done! Final output saved to {output_path}")

