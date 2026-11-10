#!/usr/bin/env bash
# Create a virtualenv (once), install the backend and serve API + built UI on :8000.
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ ! -x .venv/bin/uvicorn ]; then
  # Also repairs a half-created venv left by an earlier failed install.
  rm -rf .venv
  if ! python3 -m venv .venv; then
    echo "Could not create a Python virtualenv. On Ubuntu/WSL run:" >&2
    echo "  sudo apt update && sudo apt install -y python3 python3-venv python3-pip" >&2
    rm -rf .venv
    exit 1
  fi
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt -e .
fi
exec .venv/bin/uvicorn chemmodel.api.main:app --host 127.0.0.1 --port 8000
