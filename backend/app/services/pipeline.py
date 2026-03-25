import os
import json
import logging
import shutil
import glob
import time
from datetime import datetime
from sqlalchemy.orm import Session
from openai import OpenAI
from supabase import create_client

from app.models.project import RenderProject
from app.models.job import RenderJob
from app.models.sequence import VideoSequence
from app.models.style import CaptionStyle
from app.database import SessionLocal
from app.services.video_processor import extract_audio, download_pexels_video, init_video_service
from app.services.audio_processor import transcribe_audio, setup_viral_music, init_audio_service
from app.services.llm_service import extract_style_config, generate_styling_manifest, evaluate_broll_options, init_llm_service

def process_video_pipeline(job_id: str, input_video: str, ref_image: str, user_prompt: str, pexels_key: str, openai_key: str):
    """The orchestrator background task for a given job."""
    
    from app.database import SessionLocal
    db: Session = SessionLocal()
    job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
    
    if not job:
        logging.error(f"Job {job_id} not found in DB.")
        db.close()
        return

    project = job.project

    try:
        job.status = "processing"
        job.progress = 5.0
        db.commit()

        # Initialize clients
        client = OpenAI(api_key=openai_key)
        init_llm_service(client)
        init_audio_service(client)
        init_video_service(pexels_key)

        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        renderer_public = os.path.join(backend_dir, "..", "renderer", "public")
        renderer_src = os.path.join(backend_dir, "..", "renderer", "src")
        
        os.makedirs(os.path.join(backend_dir, "assets"), exist_ok=True)
        os.makedirs(renderer_public, exist_ok=True)

        job.progress = 10.0
        db.commit()

        # Base video is now a URL, no need to copy locally
        base_video_url = input_video

        audio_file = os.path.join(backend_dir, "assets", f"extracted_audio_{job_id}.mp3")

        job.progress = 20.0
        db.commit()

        if not extract_audio(input_video, audio_file):
            raise Exception("Failed to extract audio from video.")
            
        words = transcribe_audio(audio_file)
        logging.info(f"Extracted {len(words)} words from transcript.")

        job.progress = 40.0
        db.commit()

        # Style Extraction
        style_config = None
        global_theme = None
        if ref_image:
            style_config = extract_style_config(ref_image)
            
        if style_config:
            global_theme = style_config.get("global_theme")
            if global_theme:
                project.global_theme = global_theme
                
            for style_name, style_obj in style_config.items():
                if style_name == "global_theme":
                    continue
                new_style = CaptionStyle(
                    project_id=project.id,
                    style_name=style_name,
                    primaryColor=style_obj.get("primaryColor"),
                    backgroundColor=style_obj.get("backgroundColor"),
                    fontFamily=style_obj.get("fontFamily"),
                    fontWeight=style_obj.get("fontWeight") if str(style_obj.get("fontWeight", "")).isdigit() else None,
                    textTransform=style_obj.get("textTransform"),
                    textShadow=style_obj.get("textShadow"),
                    textStroke=style_obj.get("textStroke")
                )
                db.add(new_style)
            db.commit()

        job.progress = 50.0
        db.commit()

        # Manifest Generation
        captions_manifest = generate_styling_manifest(words, user_prompt, style_config, global_theme)

        job.progress = 70.0
        db.commit()

        # Download B-Roll
        for i, caption in enumerate(captions_manifest):
            b_roll_term = caption.get("b_roll_search_term")
            if b_roll_term:
                clean_name = "".join([c for c in b_roll_term.replace(" ", "_").lower() if c.isalpha() or c.isdigit() or c=='_']).rstrip()
                b_roll_filename = f"broll_{job_id}_{i}_{clean_name}.mp4"
                temp_path = os.path.join(backend_dir, "assets", b_roll_filename)
                
                style_key = caption.get("style", "style_basic_white")
                color_hex = style_config[style_key].get("primaryColor") if style_config and style_key in style_config else None
                
                theme_str = global_theme if global_theme else "aesthetic video"
                text_content = caption.get("text", "")
                context_prompt = f"The overall visual theme is '{theme_str}'. The video should fit the word/feeling: '{text_content}'."
                if user_prompt:
                    context_prompt += f" Ensure it appeals to the creator's vision: '{user_prompt}'."
                
                download_pexels_video(b_roll_term, temp_path, color_hex, context_prompt, evaluator_fn=evaluate_broll_options)
                
                # Upload to Supabase Storage
                supabase_url = os.getenv("SUPABASE_URL")
                supabase_key = os.getenv("SUPABASE_KEY")
                supabase = create_client(supabase_url, supabase_key)
                bucket_name = "wabisabi-assets"

                with open(temp_path, "rb") as f:
                    try:
                        supabase.storage.from_(bucket_name).upload(
                            path=b_roll_filename,
                            file=f.read(),
                            file_options={"content-type": "video/mp4"}
                        )
                    except Exception as e:
                        logging.error(f"Failed to upload b-roll: {e}")

                supabase_broll_url = supabase.storage.from_(bucket_name).get_public_url(b_roll_filename)
                caption["local_b_roll_path"] = supabase_broll_url

                if os.path.exists(temp_path):
                    os.remove(temp_path)

        job.progress = 85.0
        db.commit()

        # Music
        has_music = setup_viral_music(renderer_public, user_prompt, local_music="assets/background_music.mp3")

        # Compile final sequence
        final_sequence = []
        seq_idx = 0
        for w in words:
            w_start = w['start']
            matching_caption = captions_manifest[0] if captions_manifest else None
            if matching_caption:
                for cap in reversed(captions_manifest):
                    if cap['timestamp_start'] <= w_start + 0.5:
                        matching_caption = cap
                        break
            
            if matching_caption:
                new_seq = VideoSequence(
                    project_id=project.id,
                    timestamp_start=w['start'],
                    text=w['word'],
                    applied_style=matching_caption.get('style', 'style_basic_white'),
                    b_roll_search_term=matching_caption.get('b_roll_search_term'),
                    b_roll_url=matching_caption.get('local_b_roll_path'),
                    sequence_order=seq_idx
                )
                db.add(new_seq)
                
                final_sequence.append({
                    "timestamp_start": w['start'],
                    "text": w['word'],
                    "style": matching_caption.get('style', 'style_basic_white'),
                    "b_roll_search_term": matching_caption.get('b_roll_search_term'),
                    "local_b_roll_path": matching_caption.get('local_b_roll_path')
                })
                seq_idx += 1
                
        project.has_background_music = has_music
        project.base_video_url = base_video_url
        db.commit()

        manifest_data = {
            "has_background_music": has_music,
            "base_video_filename": base_video_url,
            "sequence": final_sequence,
            "style_config": style_config
        }

        # Optionally overwrite mock_manifest for Remotion auto-reload
        with open(os.path.join(renderer_src, "mock_manifest.json"), "w") as f:
            json.dump(manifest_data, f, indent=2)

        # Update DB
        job.status = "completed"
        job.progress = 100.0
        job.completed_at = datetime.utcnow()
        db.commit()

        logging.info(f"Pipeline complete for job {job_id}!")

    except Exception as e:
        logging.error(f"Job {job_id} failed: {e}")
        job.status = "failed"
        job.error_message = str(e)
        job.completed_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()
        try:
            audio_cleanup = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "assets", f"extracted_audio_{job_id}.mp3")
            if os.path.exists(audio_cleanup):
                os.remove(audio_cleanup)
        except Exception:
            pass
