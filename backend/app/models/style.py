from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.database import Base

class CaptionStyle(Base):
    __tablename__ = "caption_styles"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    
    style_name = Column(String, nullable=False)
    
    primaryColor = Column(String, nullable=True)
    backgroundColor = Column(String, nullable=True)
    fontFamily = Column(String, nullable=True)
    fontWeight = Column(Integer, nullable=True)
    textTransform = Column(String, nullable=True)
    textShadow = Column(String, nullable=True)
    textStroke = Column(String, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("RenderProject", back_populates="styles")
