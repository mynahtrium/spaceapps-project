#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-8000}"
URL="http://localhost:${PORT}/web/?demo=1"

if command -v node >/dev/null 2>&1; then
  SERVER_CMD=(node scripts/server.mjs)
elif command -v python3 >/dev/null 2>&1; then
  SERVER_CMD=(python3 -m http.server "$PORT")
elif command -v python >/dev/null 2>&1; then
  SERVER_CMD=(python -m http.server "$PORT")
else
  echo "[ERROR] Neither Node.js nor Python 3 found in PATH." >&2
  exit 1
fi

echo "Starting Martian Mappers local server on port ${PORT}..."
echo "Demo-safe URL : ${URL}"
echo "Normal URL    : http://localhost:${PORT}/web/"
echo "Multiplayer   : ${SERVER_CMD[*]}"
echo "Press Ctrl+C to stop."

if command -v start >/dev/null 2>&1; then
  start "$URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

PORT="$PORT" exec "${SERVER_CMD[@]}"
