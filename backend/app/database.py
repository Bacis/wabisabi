import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

# Use POSTGRESQL from Supabase if provided, otherwise fallback to local sqlite
# If the user provides a Supabase postgres URL starting with postgres://, SQLAlchemy requires postgresql://
raw_db_url = os.getenv("DATABASE_URL")
if not raw_db_url:
    raise ValueError("DATABASE_URL environment variable is not set")

if raw_db_url.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = raw_db_url.replace("postgres://", "postgresql://", 1)
else:
    SQLALCHEMY_DATABASE_URL = raw_db_url

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
