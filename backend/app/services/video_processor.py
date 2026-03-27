import logging
import ffmpeg
import requests

PEXELS_API_KEY = None # We will set this in main.py or from env in the service

def init_video_service(pexels_key: str):
    global PEXELS_API_KEY
    PEXELS_API_KEY = pexels_key

def extract_audio(video_path: str, audio_path: str):
    """Extracts audio from a video file using ffmpeg."""
    logging.info(f"Extracting audio from {video_path} to {audio_path}")
    try:
        (
            ffmpeg
            .input(video_path)
            .output(audio_path, acodec='libmp3lame', q=4)
            .overwrite_output()
            .run(quiet=True)
        )
        logging.info("Audio extraction complete.")
        return True
    except ffmpeg.Error as e:
        logging.error(f"Error extracting audio: {e.stderr.decode() if e.stderr else str(e)}")
        return False

def concat_videos(video_paths: list[str], output_path: str):
    """Concatenates multiple video files into a single video."""
    logging.info(f"Concatenating {len(video_paths)} videos...")
    try:
        inputs = []
        for vp in video_paths:
            v_in = ffmpeg.input(vp)
            # Normalize to 720x1280, 30fps
            v = v_in.video.filter('scale', 720, 1280, force_original_aspect_ratio='decrease').filter('pad', 720, 1280, '(ow-iw)/2', '(oh-ih)/2').filter('fps', fps=30)
            a = v_in.audio
            inputs.extend([v, a])
        
        joined = ffmpeg.concat(*inputs, v=1, a=1).node
        out = ffmpeg.output(joined[0], joined[1], output_path, vcodec='libx264', acodec='aac', preset='fast')
        out.run(overwrite_output=True, quiet=True)
        logging.info("Video concatenation complete.")
        return True
    except ffmpeg.Error as e:
        logging.error(f"Error concatenating videos: {e.stderr.decode() if e.stderr else str(e)}")
        return False

def download_pexels_video(query: str, save_path: str, color_hex: str = None, context_prompt: str = None, evaluator_fn=None):
    """Downloads a video from Pexels based on the search query."""
    if not PEXELS_API_KEY:
        logging.warning("No Pexels API Key provided. Skipping B-roll download.")
        return False
        
    logging.info(f"Searching Pexels for B-roll: {query} (Color: {color_hex})")
    headers = {"Authorization": PEXELS_API_KEY}
    search_url = f"https://api.pexels.com/videos/search?query={query}&per_page=5&orientation=landscape"
    
    if color_hex:
        clean_color = color_hex.replace("#", "")
        search_url += f"&color={clean_color}"
    
    try:
        response = requests.get(search_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        videos = data.get("videos")
        if not videos:
            logging.info(f"No videos found for {query}")
            return False
            
        best_index = 0
        if context_prompt and len(videos) > 1 and evaluator_fn:
            best_index = evaluator_fn(videos, context_prompt, color_hex)
            
        selected_video = videos[best_index]
        video_files = selected_video["video_files"]
        video_url = video_files[0]["link"]
        
        logging.info(f"Downloading B-roll from {video_url}...")
        v_res = requests.get(video_url, stream=True)
        v_res.raise_for_status()
        
        with open(save_path, "wb") as f:
            for chunk in v_res.iter_content(chunk_size=8192):
                f.write(chunk)
        logging.info(f"Saved B-roll to {save_path}")
        return True
    except Exception as e:
        logging.error(f"Error downloading from Pexels: {e}")
        return False
