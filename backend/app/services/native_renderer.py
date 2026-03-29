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

from app.services.font_manager import get_font_path

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

        # Clear canvas each frame for block rendering
        frame_canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))

        if active_segment:
            segment_words = [w for w in transcript_words if active_segment["start_time"] <= w["start"] <= active_segment["end_time"]]
            
            if segment_words:
                # Paginate into chunks of 4 MAX!
                pages = [segment_words[i:i+4] for i in range(0, len(segment_words), 4)]
                active_page = pages[0]
                for p in pages:
                    if current_time_sec >= p[0]["start"] - 0.1:
                        active_page = p
                
                style_key = active_segment.get("style", "style_basic_white") if active_segment else "style_basic_white"
                style_def = style_config.get(style_key, {}) if style_config else {}
                
                raw_words = [w["word"].strip() for w in active_page]
                if style_def.get("textTransform") == "uppercase":
                    raw_words = [w.upper() for w in raw_words]
                elif style_def.get("textTransform") == "lowercase":
                    raw_words = [w.lower() for w in raw_words]
                    
                font_path = get_font_path(style_def.get("fontFamily"))
                primary_col_str = style_def.get("primaryColor") or "#FFFFFF"
                is_alternating = False
                alt_colors = style_def.get("alternateColors")
                
                if alt_colors and isinstance(alt_colors, list) and len(alt_colors) > 1:
                    is_alternating = True
                    primary_col = alt_colors[0]
                elif alt_colors and isinstance(alt_colors, str) and "," in alt_colors:
                    alt_colors = [c.strip() for c in alt_colors.split(",")]
                    is_alternating = True
                    primary_col = alt_colors[0]
                elif isinstance(primary_col_str, str) and "," in primary_col_str:
                    alt_colors = [c.strip() for c in primary_col_str.split(",")]
                    is_alternating = True
                    primary_col = alt_colors[0]
                else:
                    primary_col = primary_col_str
                
                dummy_img = Image.new("RGBA", (1,1))
                dummy_draw = ImageDraw.Draw(dummy_img)

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
                        
                    page_zone_cache[active_page_id] = {"x": bz_x, "y": bz_y, "w": bz_w, "h": bz_h}

                padding_x = int(width * 0.05)
                max_w_default = width - (2 * padding_x)
                
                if segment_mode == "text_behind_subject":
                    safe_zone = page_zone_cache[active_page_id]
                    max_w = safe_zone["w"]
                    max_h = safe_zone["h"]
                    start_y = safe_zone["y"]
                    zone_pad_x = safe_zone["x"]
                    # Binary Search for maximal font size
                    min_f = 20
                    max_f = int(height * 0.5)
                    best_f = 40
                    best_lines = []
                    
                    for _ in range(15):
                        mid_f = (min_f + max_f) // 2
                        try: 
                            font_test = ImageFont.truetype(font_path, mid_f)
                        except: 
                            font_test = ImageFont.load_default()
                            
                        space_w = font_test.getlength(" ")
                        
                        lines = []
                        current_line = []
                        current_w = 0
                        
                        for idx, w_str in enumerate(raw_words):
                            word_w = int(font_test.getlength(w_str))
                            if current_w + space_w + word_w > max_w and len(current_line) > 0:
                                lines.append(current_line)
                                current_line = [(idx, w_str)]
                                current_w = word_w
                            else:
                                current_line.append((idx, w_str))
                                current_w += word_w + (space_w if len(current_line) > 1 else 0)
                                
                        if current_line:
                            lines.append(current_line)
                            
                        # Calculate height
                        total_block_h = 0
                        for line in lines:
                            line_str = " ".join([w_str for _, w_str in line])
                            bbox = dummy_draw.textbbox((0, 0), line_str, font=font_test)
                            total_block_h += (bbox[3] - bbox[1]) + int(mid_f * 0.1)
                            
                        if total_block_h > max_h:
                            max_f = mid_f - 1
                        else:
                            best_f = mid_f
                            best_lines = lines
                            min_f = mid_f + 1

                    f_size = best_f
                    lines = best_lines
                    if not lines: # Fallback if error
                        lines = [[(idx, w_str) for idx, w_str in enumerate(raw_words)]]
                    align_center = False
                    is_zone_wrap = True
                else:
                    # Standard Mode: fixed font size, bottom center aligned
                    f_size = int(width * 0.08)
                    try: font_test = ImageFont.truetype(font_path, f_size)
                    except: font_test = ImageFont.load_default()
                    
                    space_w = font_test.getlength(" ")
                    lines = []
                    current_line = []
                    current_w = 0
                    max_w = max_w_default
                    
                    for idx, w_str in enumerate(raw_words):
                        word_w = int(font_test.getlength(w_str))
                        if current_w + space_w + word_w > max_w and len(current_line) > 0:
                            lines.append(current_line)
                            current_line = [(idx, w_str)]
                            current_w = word_w
                        else:
                            current_line.append((idx, w_str))
                            current_w += word_w + (space_w if len(current_line) > 1 else 0)
                    if current_line: lines.append(current_line)
                    
                    total_block_h = 0
                    for line in lines:
                        line_str = " ".join([w_str for _, w_str in line])
                        bbox = dummy_draw.textbbox((0, 0), line_str, font=font_test)
                        total_block_h += (bbox[3] - bbox[1]) + int(f_size * 0.1)
                        
                    start_y = int(height * 0.85) - total_block_h
                    align_center = True
                    is_zone_wrap = False
                    max_w = max_w_default

                try: 
                    font = ImageFont.truetype(font_path, f_size)
                except: 
                    font = ImageFont.load_default()
                    
                space_w = font.getlength(" ")
                
                # Precalculate all line heights to know exact block span
                line_heights = []
                for line in lines:
                    line_str = " ".join([w_str for _, w_str in line])
                    bbox = dummy_draw.textbbox((0, 0), line_str, font=font)
                    lh = bbox[3] - bbox[1]
                    line_heights.append(lh)
                
                draw = ImageDraw.Draw(frame_canvas)
                strk_w, strk_col = parse_stroke(style_def.get("textStroke"), f_size)
                shadows = parse_shadows(style_def.get("textShadow"), f_size)
                
                current_y = start_y
                letter_idx = 0
                
                for line_idx, line in enumerate(lines):
                    line_str = " ".join([w_str for _, w_str in line])
                    bbox = dummy_draw.textbbox((0, 0), line_str, font=font)
                    line_w = bbox[2] - bbox[0]
                    line_h = line_heights[line_idx]
                    
                    if align_center:
                        current_x = int((width - line_w) / 2)
                    elif is_zone_wrap:
                        current_x = zone_pad_x + int((max_w - line_w) / 2)
                    else:
                        current_x = padding_x
                    
                    for word_tuple in line:
                        orig_idx, w_str = word_tuple
                        w_start = active_page[orig_idx]["start"]
                        
                        is_visible = current_time_sec >= w_start
                        
                        if is_alternating:
                            for char in w_str:
                                if char.strip():
                                    char_color = alt_colors[letter_idx % len(alt_colors)]
                                    letter_idx += 1
                                else:
                                    char_color = primary_col
                                    
                                if is_visible:
                                    for shad in shadows:
                                        draw.text((current_x + shad["x"], current_y + shad["y"]), char, font=font, fill=shad["color"])
                                    draw.text((current_x, current_y), char, font=font, fill=char_color, stroke_width=strk_w, stroke_fill=strk_col)
                                    
                                current_x += int(font.getlength(char))
                        else:
                            if is_visible:
                                for shad in shadows:
                                    draw.text((current_x + shad["x"], current_y + shad["y"]), w_str, font=font, fill=shad["color"])
                                draw.text((current_x, current_y), w_str, font=font, fill=primary_col, stroke_width=strk_w, stroke_fill=strk_col)
                                
                            current_x += int(font.getlength(w_str))
                            
                        # Space advance
                        current_x += int(space_w)
                        
                    current_y += line_h + int(f_size * 0.1)
                
        frame_path = os.path.join(tmp_frames_dir, f"frame_{frame_idx:04d}.png")
        frame_canvas.save(frame_path)

    cap.release()
    writer.release()
    segmenter.close()

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

