#!/bin/bash
set -e

echo "[start] Running database migrations..."
node /app/api-server/migrate.mjs

echo "[start] Starting server..."
exec node --enable-source-maps /app/api-server/dist/index.cjs
