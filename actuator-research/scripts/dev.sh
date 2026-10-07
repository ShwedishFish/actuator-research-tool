#!/usr/bin/env bash
# Start the dev server with auto-reload on http://127.0.0.1:8001/
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port "${PORT:-8001}"
