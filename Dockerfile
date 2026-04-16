# ---------------------------------------------------------------------------
# Stage 1: Python virtual environment with CPU-only torch
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS python-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git \
    && rm -rf /var/lib/apt/lists/*

COPY transcribe-py/requirements-cpu.txt /tmp/requirements-cpu.txt
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements-cpu.txt

# ---------------------------------------------------------------------------
# Stage 2: Node.js dependencies
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS node-deps

WORKDIR /app

# Root package. Build toolchain for native addons (better-sqlite3 in
# particular) — this is a node-deps *build* stage so it's fine to have
# a compiler here; the final image ditches it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# No --ignore-scripts: better-sqlite3 ships a postinstall that compiles
# its native .node addon against the current Node ABI. Without it, every
# process that imports the module crashes with "Could not locate the
# bindings file" at runtime.
RUN npm ci

# Remotion sub-package. --ignore-scripts is safe here: the Remotion
# packages don't have native addons we need to build, and skipping the
# postinstalls keeps the image build deterministic (the final stage
# explicitly runs `npx remotion browser ensure` to cache Chromium).
COPY remotion/package.json remotion/package-lock.json* ./remotion/
RUN cd remotion && npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 3: Final image
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

# System dependencies: ffmpeg, Python 3, and libs needed by Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 python3-venv \
    # Chromium runtime dependencies (Remotion's ensureBrowser downloads its own binary)
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-noto-color-emoji fonts-liberation \
    # MediaPipe / OpenCV headless deps
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python venv from stage 1
COPY --from=python-deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy node_modules from stage 2
COPY --from=node-deps /app/node_modules ./node_modules
COPY --from=node-deps /app/remotion/node_modules ./remotion/node_modules

# Copy application source
COPY . .

# Download Remotion's Chromium build at image build time so it's cached
RUN npx remotion browser ensure

# Ensure storage directories exist
RUN mkdir -p /app/storage/inputs /app/storage/outputs /app/storage/work

# Defaults — override via Railway env vars or docker-compose environment
ENV STORAGE_DIR=/app/storage
ENV SQLITE_PATH=/app/storage/captions.db
ENV REMOTION_PROJECT=/app/remotion
ENV PYTHON_BIN=/opt/venv/bin/python
ENV TRANSCRIBE_SCRIPT=/app/transcribe-py/transcribe.py
ENV FACES_SCRIPT=/app/transcribe-py/detect_faces.py
ENV RENDER_MODE=local
ENV REMOTION_GL=swangle
# HuggingFace model cache. Keep it OUT of /app/storage so it doesn't eat
# the Railway volume (models are 100s of MB and would compound per deploy).
# The image layer is ephemeral but free — on a fresh container boot the
# first transcribe request will re-download ~140 MB for the base Whisper
# model, which is a few seconds on Railway's network. Worth it for bounded
# storage cost.
ENV HF_HOME=/opt/hf-cache
ENV PORT=3000
RUN mkdir -p /opt/hf-cache

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
