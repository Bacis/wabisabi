from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.database import Base

class RenderProject(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=True)
    prompt = Column(String, nullable=True)
    
    base_video_url = Column(String, nullable=True)
    reference_image_url = Column(String, nullable=True)
    has_background_music = Column(Boolean, default=False)
    
    global_theme = Column(String, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("RenderJob", back_populates="project", uselist=False, cascade="all, delete-orphan")
    sequences = relationship("VideoSequence", back_populates="project", cascade="all, delete-orphan", order_by="VideoSequence.sequence_order")
    styles = relationship("CaptionStyle", back_populates="project", cascade="all, delete-orphan")
