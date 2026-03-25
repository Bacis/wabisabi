from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

from app.models.project import RenderProject
from app.models.job import RenderJob
from app.models.style import CaptionStyle

jobs = db.query(RenderJob).order_by(RenderJob.created_at.desc()).limit(3).all()

def obj_to_dict(obj):
    d = {}
    for column in obj.__table__.columns:
        val = getattr(obj, column.name)
        d[column.name] = val.isoformat() if isinstance(val, datetime) else val
    return d

output = []
for j in jobs:
    job_dict = obj_to_dict(j)
    proj = db.query(RenderProject).filter(RenderProject.id == j.project_id).first()
    styles = db.query(CaptionStyle).filter(CaptionStyle.project_id == j.project_id).all()
    
    job_dict['project'] = obj_to_dict(proj) if proj else None
    job_dict['styles'] = [obj_to_dict(s) for s in styles]
    output.append(job_dict)

print(json.dumps(output, indent=2))
db.close()
