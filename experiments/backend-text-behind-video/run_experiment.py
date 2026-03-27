import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import subprocess
import os
import shutil

# Copy input video from React frontend if available
INPUT_PATH = "IMG_1478.MOV"

if not os.path.exists(INPUT_PATH):
    print(f"Error: Could not find {INPUT_PATH} in current directory.")
    exit(1)

OUTPUT_TMP = "tmp_mask.mp4"
OUTPUT_FINAL = "final_output.mp4"

import whisper
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# Setup MediaPipe Tasks API natively (Modern Pipeline)
base_options = python.BaseOptions(model_asset_path='selfie_segmenter.tflite')
options = vision.ImageSegmenterOptions(
    base_options=base_options,
    output_category_mask=True
)
segmenter = vision.ImageSegmenter.create_from_options(options)

print("Booting Whisper tiny AI Transcriber...")
transcriber = whisper.load_model("tiny")
print("Transcribing source audio for exact word timestamps...")
transcription_result = transcriber.transcribe(INPUT_PATH, word_timestamps=True)

spoken_words = []
for segment in transcription_result.get("segments", []):
    for word_obj in segment.get("words", []):
        spoken_words.append(word_obj)
        
print(f"Transcription complete! Snagged {len(spoken_words)} precise word boundaries.")

cap = cv2.VideoCapture(INPUT_PATH)
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

# Opencv video writer - STRICTLY for exporting the binary Mask!
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
writer = cv2.VideoWriter(OUTPUT_TMP, fourcc, fps, (width, height))

# Initialize Persistent Canvas Tracking!
cumulative_canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
# Tracks exactly which pixels have typography baked onto them (0 = empty, 255 = occupied) 
cumulative_text_mask = np.zeros((height, width), dtype=np.uint8)
spoken_history = set()

# Dummy draw surface just for pre-calculating string pixel footprints flawlessly
dummy_img = Image.new("RGBA", (1, 1))
dummy_draw = ImageDraw.Draw(dummy_img)

import random

def place_word(mask, text, frame_width, frame_height):
    # Mathematically find exact intersections where BOTH the physical background is open, AND no prior text exists.
    # TFLite Output 255 = Background, 0 = Person
    available_mask = ((mask == 255) & (cumulative_text_mask == 0)).astype(np.uint8) * 255
    
    # Force heavy sans-serif fonts natively packaged on Macs!
    try: font_path = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
    except: font_path = "/System/Library/Fonts/HelveticaNeue.ttc"
    
    # Try 50 randomly sized typography targets, sorted identically from LARGEST to SMALLEST to force violent Hopecore scaling
    sizes = sorted([random.randint(int(frame_width * 0.1), int(frame_width * 0.35)) for _ in range(50)], reverse=True)
    
    for f_size in sizes:
        try: font = ImageFont.truetype(font_path, f_size)
        except: font = ImageFont.load_default()
        
        bbox = dummy_draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        
        # Word is physically too large to fit the entire screen context
        if tw >= frame_width or th >= frame_height:
            continue
            
        # Monte-Carlo test 15 coordinate drops looking for a perfectly clear hole in the background wall
        for _ in range(15):
            rx = random.randint(0, frame_width - tw)
            ry = random.randint(0, frame_height - th)
            
            # Slice precisely the proposed bounding box out of the available background boolean map
            patch = available_mask[ry:ry+th, rx:rx+tw]
            
            # Mathematical Safety Check: Ensure >90% of the proposed typography layout lands in pure empty space!
            if np.mean(patch == 255) > 0.90:
                return rx, ry, f_size, font
                
    # Fallback to a standard drop if the layout is mathematically suffocated by 90% completion
    fallback_size = int(frame_width * 0.12)
    try: font = ImageFont.truetype(font_path, fallback_size)
    except: font = ImageFont.load_default()
    
    return random.randint(0, max(1, frame_width - int(frame_width * 0.2))), random.randint(0, max(1, frame_height - int(frame_width * 0.2))), fallback_size, font


os.makedirs("tmp_text_frames", exist_ok=True)

print(f"Extracting AI binary mask & dynamic cumulative text frames for {total_frames} frames...")
frame_idx = 0

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
        
    frame_idx += 1
    current_time_sec = frame_idx / fps
    if frame_idx % 30 == 0:
        print(f"Processed mask & text frame {frame_idx}/{total_frames}...")

    # ML Mask Extraction happens every frame natively to feed the FFmpeg alphamerge person_cutout tracking
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    segmentation_result = segmenter.segment(mp_image)
    
    mask = segmentation_result.category_mask.numpy_view()
    mask = np.squeeze(mask) 
    
    binary_mask = np.where(mask == 0, 255, 0).astype(np.uint8)
    mask_bgr = cv2.cvtColor(binary_mask, cv2.COLOR_GRAY2BGR)
    writer.write(mask_bgr)

    # Active Subtitle Check
    active_word_obj = None
    for w in spoken_words:
        if w["start"] <= current_time_sec <= w["end"]:
            active_word_obj = w
            break
            
    # Subtitle Collision Solver: ONLY triggers precisely on millisecond 1 of a newly recognized Whisper timestamp
    if active_word_obj and active_word_obj["start"] not in spoken_history:
        text_str = active_word_obj["word"].strip().upper()
        
        # Compute collision-free mapping mathematically based on the CURRENT frame's ML mask bounds
        rx, ry, f_size, font = place_word(mask, text_str, width, height)
        
        # Permanently glue it into the accumulating transparency layer
        draw = ImageDraw.Draw(cumulative_canvas)
        stroke_width = max(int(f_size * 0.04), 2)
        draw.text((rx, ry), text_str, font=font, fill="#FFD700", stroke_width=stroke_width, stroke_fill="black")
        
        # Track that this specific bounding box is permanently occupied logic out
        bbox = draw.textbbox((rx, ry), text_str, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        
        ry_end = min(ry + th, height)
        rx_end = min(rx + tw, width)
        cumulative_text_mask[ry:ry_end, rx:rx_end] = 255
        
        spoken_history.add(active_word_obj["start"])
            
    # Regardless of rendering state machine, we MUST save the cumulative canvas natively to build the video
    frame_path = f"tmp_text_frames/frame_{frame_idx:04d}.png"
    cumulative_canvas.save(frame_path)
    
cap.release()
writer.release()
segmenter.close()

print("\nHardware Compositing via FFmpeg using Image Sequence overlay...")
cmd = [
    "ffmpeg", "-y",
    "-i", INPUT_PATH,
    "-framerate", str(fps),
    "-i", "tmp_text_frames/frame_%04d.png",
    "-i", INPUT_PATH,
    "-i", OUTPUT_TMP,
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
    "-shortest", OUTPUT_FINAL
]

subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if os.path.exists(OUTPUT_TMP):
    os.remove(OUTPUT_TMP)
if os.path.exists("tmp_text_frames"):
    shutil.rmtree("tmp_text_frames")
    
print(f"Successfully composited Dynamic AI Transcribed video natively. File stored to: {OUTPUT_FINAL}")
