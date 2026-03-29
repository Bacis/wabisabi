from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import os
import shutil
from supabase import create_client

from app.database import get_db
from app.models.project import RenderProject
from app.models.job import RenderJob
from app.models.sequence import VideoSequence
from app.models.style import CaptionStyle
from app.services.native_pipeline import process_native_video_pipeline
router = APIRouter()

class JobResponse(BaseModel):
    job_id: str
    status: str

@router.post("/generate", response_model=JobResponse)
async def generate_video(
    background_tasks: BackgroundTasks,
    prompt: str = Form(""),
    connect_music: bool = Form(True),
    external_videos_amount: int = Form(10),
    videos: list[UploadFile] = File(...),
    ref_images: list[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    # Retrieve API keys
    openai_key = os.getenv("OPENAI_API_KEY")
    pexels_key = os.getenv("PEXELS_API_KEY")
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    
    if not openai_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=500, detail="SUPABASE credentials are not configured")
        
    # Create project and job in database
    new_project = RenderProject(prompt=prompt)
    db.add(new_project)
    db.commit()
    db.refresh(new_project)

    new_job = RenderJob(project_id=new_project.id, status="pending")
    db.add(new_job)
    db.commit()
    db.refresh(new_job)
    
    supabase = create_client(supabase_url, supabase_key)
    bucket_name = "wabisabi-assets"
    
    # Upload videos
    input_video_urls = []
    for i, v in enumerate(videos):
        if v.filename:
            v_ext = os.path.splitext(v.filename)[1]
            v_filename = f"input_{new_job.id}_{i}{v_ext}"
            v_bytes = await v.read()
            supabase.storage.from_(bucket_name).upload(
                path=v_filename,
                file=v_bytes,
                file_options={"content-type": v.content_type}
            )
            input_video_urls.append(supabase.storage.from_(bucket_name).get_public_url(v_filename))
        
    # Save ref images
    ref_image_urls = []
    if ref_images:
        for i, r in enumerate(ref_images):
            if r.filename:
                r_ext = os.path.splitext(r.filename)[1]
                if not r_ext:
                    r_ext = ".jpg"  # Default extension if missing
                r_filename = f"ref_{new_job.id}_{i}{r_ext}"
                r_bytes = await r.read()
                supabase.storage.from_(bucket_name).upload(
                    path=r_filename,
                    file=r_bytes,
                    file_options={"content-type": r.content_type}
                )
                ref_image_urls.append(supabase.storage.from_(bucket_name).get_public_url(r_filename))
            
    # Add pipeline to background tasks (Native FFmpeg Pipeline)
    background_tasks.add_task(
        process_native_video_pipeline,
        job_id=new_job.id,
        input_videos=input_video_urls,
        ref_images=ref_image_urls,
        user_prompt=prompt,
        connect_music=connect_music,
        external_videos_amount=external_videos_amount,
        pexels_key=pexels_key,
        openai_key=openai_key
    )
    
    return {"job_id": new_job.id, "status": new_job.status}

@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    manifest = None
    if job.status == "completed":
        project = job.project
        sequences = db.query(VideoSequence).filter(VideoSequence.project_id == project.id).order_by(VideoSequence.sequence_order).all()
        styles = db.query(CaptionStyle).filter(CaptionStyle.project_id == project.id).all()
        
        style_config = {}
        for s in styles:
            style_config[s.style_name] = {
                "primaryColor": s.primaryColor,
                "backgroundColor": s.backgroundColor,
                "fontFamily": s.fontFamily,
                "fontWeight": s.fontWeight,
                "textTransform": s.textTransform,
                "textShadow": s.textShadow,
                "textStroke": s.textStroke
            }
            
        manifest = {
            "has_background_music": project.has_background_music,
            "background_music_url": job.details.get("background_music_url") if job.details and isinstance(job.details, dict) else None,
            "base_video_filename": project.base_video_url,
            "sequence": [
                {
                    "timestamp_start": seq.timestamp_start,
                    "text": seq.text,
                    "style": seq.applied_style,
                    "b_roll_search_term": seq.b_roll_search_term,
                    "local_b_roll_path": seq.b_roll_url
                } for seq in sequences
            ],
            "style_config": style_config if style_config else None
        }

    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "details": job.details,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "error_message": job.error_message,
        "result_manifest": manifest
    }

