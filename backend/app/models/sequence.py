from sqlalchemy import Column, String, Float, Integer, ForeignKey
from sqlalchemy.orm import relationship
import uuid
from app.database import Base

class VideoSequence(Base):
    __tablename__ = "video_sequences"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    
    timestamp_start = Column(Float, nullable=False)
    text = Column(String, nullable=False)
    applied_style = Column(String, nullable=True)
    
    b_roll_search_term = Column(String, nullable=True)
    b_roll_url = Column(String, nullable=True)
    
    sequence_order = Column(Integer, nullable=False)

    project = relationship("RenderProject", back_populates="sequences")
