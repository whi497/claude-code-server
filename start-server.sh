#!/bin/bash
# Wrapper script for PM2: rebuilds client then starts server.
# This ensures `pm2 restart claude-code-server` always serves fresh frontend assets.

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[start-server] Rebuilding client..."
cd "$ROOT_DIR"
npm run build:client 2>&1
echo "[start-server] Client rebuild complete. Starting server..."

cd "$ROOT_DIR/server"
exec node_modules/.bin/tsx src/index.ts
