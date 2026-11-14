#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-8000}"
URL="http://localhost:${PORT}/web/?demo=1"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[ERROR] Python 3 not found in PATH." >&2
  exit 1
fi

echo "Starting Martian Mappers local server on port ${PORT}..."
echo "Demo-safe URL : ${URL}"
echo "Normal URL    : http://localhost:${PORT}/web/"
echo "Press Ctrl+C to stop."

if command -v start >/dev/null 2>&1; then
  start "$URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

exec "$PY" -m http.server "$PORT"
