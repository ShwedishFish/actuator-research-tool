#!/usr/bin/env bash
# Local quality gate (also run by CI): ruff, node --check on frontend JS, pytest.
# Run from anywhere: bash actuator-research/scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -x .venv/bin/python ]]; then
  export PATH="$PWD/.venv/bin:$PATH"
fi

echo "== ruff check"
ruff check .

echo "== node --check frontend/*.js"
for f in frontend/*.js; do
  node --check "$f"
done

echo "== pytest"
python -m pytest -q
