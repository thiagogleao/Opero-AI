#!/bin/sh
set -e
echo "[start] Running migrations..."
# Every migration step is idempotent and bounded by lock/statement timeouts
# (frontend/migrate.js); this ceiling covers an unreachable database. It stays
# well under railway.toml's 120 s healthcheck so Next.js still has time to boot.
timeout 60 node frontend/migrate.js || echo "[start] WARN: migrations failed or timed out, continuing startup"
echo "[start] Starting Next.js on port ${PORT:-3000}..."
cd frontend && exec node node_modules/next/dist/bin/next start -p ${PORT:-3000}
