FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright and its system dependencies
RUN playwright install --with-deps chromium

# Copy application code
COPY . .

# Run the FastAPI server
# Railway automatically maps the PORT environment variable
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
