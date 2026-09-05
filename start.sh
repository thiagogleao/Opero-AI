#!/bin/sh
set -e
echo "[start] Running migrations..."
# Hard ceiling on top of the in-query timeouts: the app must reach the
# healthcheck even if the database is unreachable and the client never returns.
# Kept well under railway.toml's 120s healthcheckTimeout so that even a
# worst-case migration still leaves most of the window for Next.js to boot.
timeout 45 node frontend/migrate.js || echo "[start] WARN: migrations failed or timed out, continuing startup"
echo "[start] Starting Next.js on port ${PORT:-3000}..."
cd frontend && exec node node_modules/next/dist/bin/next start -p ${PORT:-3000}
