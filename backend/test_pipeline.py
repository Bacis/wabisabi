import os
import sys
from dotenv import load_dotenv

# Expand tilde and make paths absolute
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(backend_dir)
load_dotenv()

from supabase import create_client
from app.database import SessionLocal, Base, engine
from app.models.project import RenderProject
from app.models.job import RenderJob

# Expand paths
video_path = os.path.expanduser("~/Downloads/input_orhan.mp4")
ref_image_path = os.path.expanduser("~/Downloads/reference2.jpeg")

if not os.path.exists(video_path):
    print(f"Error: Could not find video at {video_path}")
    sys.exit(1)
if not os.path.exists(ref_image_path):
    print(f"Error: Could not find reference image at {ref_image_path}")
    sys.exit(1)

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")
supabase = create_client(supabase_url, supabase_key)

db = SessionLocal()
project = RenderProject(prompt="A cinematic, philosophical, viral hopecore video using a native aesthetic.")
db.add(project)
db.commit()
db.refresh(project)

job = RenderJob(project_id=project.id, status="pending")
db.add(job)
db.commit()
db.refresh(job)
db.close()

print(f"Created Job: {job.id}")

# Upload mock files
bucket = "wabisabi-assets"
v_filename = f"test_in_{job.id}.mp4"
r_filename = f"test_ref_{job.id}.png"

print("Uploading video to Supabase...")
with open(video_path, "rb") as f:
    supabase.storage.from_(bucket).upload(path=v_filename, file=f.read(), file_options={"content-type": "video/mp4"})
video_url = supabase.storage.from_(bucket).get_public_url(v_filename)

print("Uploading reference image to Supabase...")
with open(ref_image_path, "rb") as f:
    supabase.storage.from_(bucket).upload(path=r_filename, file=f.read(), file_options={"content-type": "image/jpeg"})
ref_url = supabase.storage.from_(bucket).get_public_url(r_filename)

print("Kicking off native pipeline...")
from app.services.native_pipeline import process_native_video_pipeline

from app.database import get_db

import logging
logging.basicConfig(level=logging.INFO)

process_native_video_pipeline(
    job_id=job.id,
    input_videos=[video_url],
    ref_images=[ref_url],
    user_prompt="I want the exact pastel alternate text colors matching the reference image.",
    connect_music=False, # to skip pexels/music issues internally for this test unless we need to
    external_videos_amount=0, # purely test native texts
    pexels_key=os.environ.get("PEXELS_API_KEY"),
    openai_key=os.environ.get("OPENAI_API_KEY")
)

print("\n\nTest Finished! Checking Database job status:")
db = SessionLocal()
job_check = db.query(RenderJob).filter(RenderJob.id == job.id).first()
print(f"Final Job Status: {job_check.status}")
print(f"Job Progress: {job_check.progress}%")
print(f"Job Details: {job_check.details}")
if job_check.project.base_video_url:
    print(f"===> RESULT URL: {job_check.project.base_video_url}")
db.close()
