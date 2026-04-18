#!/bin/sh
set -e
echo "[start] Running migrations..."
node frontend/migrate.js
echo "[start] Starting Next.js on port ${PORT:-3000}..."
exec node frontend/node_modules/next/dist/bin/next start --dir frontend -p ${PORT:-3000}
