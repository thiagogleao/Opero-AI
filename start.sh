#!/bin/sh
set -e
echo "[start] Running migrations..."
node frontend/migrate.js || echo "[start] WARN: migrations failed, continuing startup"
echo "[start] Starting Next.js on port ${PORT:-3000}..."
cd frontend && exec node node_modules/next/dist/bin/next start -p ${PORT:-3000}
