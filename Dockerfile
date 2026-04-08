FROM node:20-bookworm-slim

# Install Python 3 + build tools
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv python3-dev \
    gcc g++ curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python dependencies ──────────────────────────────────────
COPY requirements.txt .
RUN python3 -m venv .venv \
    && .venv/bin/pip install --upgrade pip \
    && .venv/bin/pip install -r requirements.txt --prefer-binary

# ── Copy Python app ──────────────────────────────────────────
COPY app ./app
COPY collect_recent.py .

# ── Next.js dependencies + build ─────────────────────────────
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend
RUN cd frontend && npm run build

# ── Runtime config ────────────────────────────────────────────
ENV NODE_ENV=production
ENV PYTHON_BIN=/app/.venv/bin/python3
ENV PORT=3000

EXPOSE 3000

CMD ["node", "frontend/node_modules/next/dist/bin/next", "start", "--dir", "frontend", "-p", "3000"]
