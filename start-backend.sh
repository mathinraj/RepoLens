#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3847}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

pid=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
if [ -n "$pid" ]; then
  echo "Stopping previous instance (PID $pid) on port $PORT..."
  kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
fi

if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  npm install --prefix "$BACKEND_DIR"
fi

echo "Starting RepoLens backend on port $PORT..."
exec node "$BACKEND_DIR/server.js"
