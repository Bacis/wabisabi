import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import io

from app.main import app
from app.database import Base, get_db

from sqlalchemy.pool import StaticPool

SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Welcome to the Wabisabi Video Engine API"}

def test_generate_endpoint_requires_video():
    response = client.post("/api/generate", data={"prompt": "test"})
    # Should fail with 422 Unprocessable Entity because video is required
    assert response.status_code == 422

# To test the actual generate, we mock a video upload file
def test_generate_endpoint_success():
    # Provide a dummy file
    test_video = io.BytesIO(b"dummy video content")
    test_video.name = "test.mp4"
    
    files = {"video": ("test.mp4", test_video, "video/mp4")}
    data = {"prompt": "A sick wabisabi edit"}
    
    response = client.post("/api/generate", data=data, files=files)
    
    # We should get 200 and a job_id
    assert response.status_code == 200
    json_data = response.json()
    assert "job_id" in json_data
    assert json_data["status"] == "pending"
    
    # Now check if we can poll the status
    job_id = json_data["job_id"]
    status_response = client.get(f"/api/jobs/{job_id}")
    assert status_response.status_code == 200
    status_data = status_response.json()
    assert status_data["job_id"] == job_id
    assert status_data["status"] == "pending"
    assert status_data["progress"] == 0.0


