import os
import json
import logging
import shutil
import glob
from datetime import datetime
from sqlalchemy.orm import Session
from openai import OpenAI
from supabase import create_client

from app.models.project import RenderProject
from app.models.job import RenderJob
from app.models.sequence import VideoSequence
from app.models.style import CaptionStyle
from app.database import SessionLocal
from app.services.video_processor import extract_audio, init_video_service, concat_videos
from app.services.audio_processor import transcribe_audio, setup_viral_music, init_audio_service
from app.services.llm_service import extract_style_config, init_llm_service, generate_segment_manifest
from app.services.native_renderer import render_project_native

def process_native_video_pipeline(job_id: str, input_videos: list[str], ref_images: list[str], user_prompt: str, connect_music: bool, external_videos_amount: int, pexels_key: str, openai_key: str):
    """The orchestrator background task for a given job using the new Python Native Renderer."""
    
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
        
        os.makedirs(os.path.join(backend_dir, "assets"), exist_ok=True)

        job.progress = 10.0
        job.details = {"stage": "downloading_video"}
        db.commit()

        import requests
        
        # Download and merge input videos
        local_videos = []
        for idx, v_url in enumerate(input_videos):
            local_v_path = os.path.join(backend_dir, "assets", f"tmp_in_{job_id}_{idx}.mp4")
            v_res = requests.get(v_url, stream=True)
            v_res.raise_for_status()
            with open(local_v_path, "wb") as f:
                for chunk in v_res.iter_content(chunk_size=8192):
                    f.write(chunk)
            local_videos.append(local_v_path)
            
        merged_video_path = os.path.join(backend_dir, "assets", f"merged_input_{job_id}.mp4")
        if not concat_videos(local_videos, merged_video_path):
            raise Exception("Failed to concatenate input videos.")
            
        for p in local_videos:
            if os.path.exists(p):
                os.remove(p)

        audio_file = os.path.join(backend_dir, "assets", f"extracted_audio_{job_id}.mp3")

        job.progress = 20.0
        job.details = {"stage": "transcribing"}
        db.commit()

        if not extract_audio(merged_video_path, audio_file):
            raise Exception("Failed to extract audio from video.")
            
        words = transcribe_audio(audio_file)
        logging.info(f"Extracted {len(words)} words from transcript.")

        job.progress = 40.0
        job.details = {"stage": "extracting_styles", "words_count": len(words)}
        db.commit()

        # Style Extraction
        style_config = None
        global_theme = None
        if ref_images:
            style_config = extract_style_config(ref_images)
            if style_config:
                global_theme = style_config.get("global_theme")
                if global_theme:
                    project.global_theme = global_theme
                    
                for style_name, style_obj in style_config.items():
                    if style_name == "global_theme":
                        continue
                    primary_color = style_obj.get("primaryColor")
                    alt_colors = style_obj.get("alternateColors")
                    if alt_colors and isinstance(alt_colors, list) and len(alt_colors) > 1:
                        primary_color = ",".join(alt_colors)
                        
                    new_style = CaptionStyle(
                        project_id=project.id,
                        style_name=style_name,
                        primaryColor=primary_color,
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
        job.details = {"stage": "generating_manifest", "words_count": len(words), "styles": style_config}
        db.commit()

        # Generate Contextual Segments
        segments = generate_segment_manifest(words, user_prompt, style_config, global_theme)

        job.progress = 70.0
        job.details = {"stage": "rendering_natively", "segments_count": len(segments)}
        db.commit()
        
        # Native Pipeline Rendering
        output_video_path = os.path.join(backend_dir, "assets", f"native_output_{job_id}.mp4")
        
        # We pass the transcriped words directly to match timing within each segment block perfectly
        render_project_native(merged_video_path, words, segments, style_config, output_video_path)

        job.progress = 90.0
        job.details = {"stage": "uploading_final"}
        db.commit()
        
        # Upload Native to Supabase
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        supabase = create_client(supabase_url, supabase_key)
        bucket_name = "wabisabi-assets"
        
        final_filename = f"native_final_{job_id}.mp4"
        with open(output_video_path, "rb") as f:
            supabase.storage.from_(bucket_name).upload(
                path=final_filename, file=f.read(), file_options={"content-type": "video/mp4"}
            )
        base_video_url = supabase.storage.from_(bucket_name).get_public_url(final_filename)
        
        project.base_video_url = base_video_url
        db.commit()

        # Update DB Sequences to reflect our segments so they show in API responses
        seq_idx = 0
        for seg in segments:
            new_seq = VideoSequence(
                project_id=project.id,
                timestamp_start=seg.get('start_time', 0),
                text=seg.get('text_content', ''),
                applied_style=seg.get('style', 'style_basic_white'),
                b_roll_search_term=seg.get('b_roll_search_term'),
                sequence_order=seq_idx
            )
            db.add(new_seq)
            seq_idx += 1
            
        db.commit()

        # Update DB
        job.status = "completed"
        job.progress = 100.0
        job.completed_at = datetime.utcnow()
        db.commit()

        logging.info(f"Native Pipeline complete for job {job_id}!")

        # Cleanup
        # if os.path.exists(output_video_path): os.remove(output_video_path)
        if os.path.exists(merged_video_path): os.remove(merged_video_path)

    except Exception as e:
        logging.error(f"Native Job {job_id} failed: {e}")
        job.status = "failed"
        job.error_message = str(e)
        job.details = {"stage": "error", "error": str(e)}
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

