import logging
import yt_dlp
import shutil
import os

client = None # To be initialized with the OpenAI client

def init_audio_service(openai_client):
    global client
    client = openai_client

def transcribe_audio(audio_path: str):
    """Uses OpenAI Whisper API to transcribe audio with word-level timestamps."""
    logging.info(f"Transcribing {audio_path} with Whisper...")
    with open(audio_path, "rb") as audio_file:
        transcription = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["word"]
        )
    words = [{"word": w.word, "start": w.start, "end": w.end} for w in transcription.words]
    return words

def extract_audio_query(user_prompt: str):
    """If the user prompt asks for a certain style of music, extract a YouTube search query."""
    logging.info(f"Extracting audio direction from prompt: {user_prompt}")
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Extract ONLY the requested background music or song name from the prompt to use as a YouTube search query. If no specific music is implied, reply with 'NONE'."},
                {"role": "user", "content": user_prompt}
            ]
        )
        query = response.choices[0].message.content.strip()
        return query if query.upper() != "NONE" else None
    except Exception:
        return None

def setup_viral_music(save_path: str, user_prompt: str = None):
    """Downloads a viral track from YouTube to the specified save_path."""
    
    logging.info("Determining background music query...")
    
    query = None
    if user_prompt:
        query = extract_audio_query(user_prompt)
        
    if not query:
        logging.info("No specific user track requested, using proven viral track.")
        proven_tracks = [
            "M83 Outro slowed reverb audio",
            "Beach House Space Song slowed audio",
            "Aphex Twin QKThr slowed audio",
            "Interstellar Cornfield Chase piano slow",
            "Mac DeMarco Chamber of Reflection slowed"
        ]
        import random
        query = random.choice(proven_tracks)
        
    logging.info(f"Targeting track: '{query}'")
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': save_path.replace('.mp3', ''),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'quiet': True,
        'default_search': 'scsearch1',
        'noplaylist': True
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([query])
        logging.info("Viral track acquired successfully!")
        return save_path
    except Exception as e:
        logging.error(f"Failed to fetch viral audio from YouTube: {e}")
        
    return None
