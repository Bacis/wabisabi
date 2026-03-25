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
from app.services.pipeline import process_video_pipeline

router = APIRouter()

class JobResponse(BaseModel):
    job_id: str
    status: str

@router.post("/generate", response_model=JobResponse)
async def generate_video(
    background_tasks: BackgroundTasks,
    prompt: str = Form(""),
    video: UploadFile = File(...),
    ref_image: UploadFile = File(...),
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
    
    # Upload video
    video_ext = os.path.splitext(video.filename)[1]
    input_video_filename = f"input_{new_job.id}{video_ext}"
    video_bytes = await video.read()
    supabase.storage.from_(bucket_name).upload(
        path=input_video_filename,
        file=video_bytes,
        file_options={"content-type": video.content_type}
    )
    input_video_url = supabase.storage.from_(bucket_name).get_public_url(input_video_filename)
        
    # Save ref image if present
    ref_image_url = None
    if ref_image and ref_image.filename:
        ref_ext = os.path.splitext(ref_image.filename)[1]
        if not ref_ext:
            ref_ext = ".jpg"  # Default extension if missing
        ref_image_filename = f"ref_{new_job.id}{ref_ext}"
        ref_bytes = await ref_image.read()
        supabase.storage.from_(bucket_name).upload(
            path=ref_image_filename,
            file=ref_bytes,
            file_options={"content-type": ref_image.content_type}
        )
        ref_image_url = supabase.storage.from_(bucket_name).get_public_url(ref_image_filename)
            
    # Add pipeline to background tasks
    background_tasks.add_task(
        process_video_pipeline,
        job_id=new_job.id,
        input_video=input_video_url,
        ref_image=ref_image_url,
        user_prompt=prompt,
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
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "error_message": job.error_message,
        "result_manifest": manifest
    }

