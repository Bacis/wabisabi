import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.database import engine, Base
from app.api.routes import video
import app.models

load_dotenv()

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Wabisabi Video Engine API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(video.router, prefix="/api", tags=["video"])

@app.get("/")
def read_root():
    return {"message": "Welcome to the Wabisabi Video Engine API"}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
