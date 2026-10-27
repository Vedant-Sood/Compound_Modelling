#!/usr/bin/env bash
# Create a virtualenv (once), install the backend and serve API + built UI on :8000.
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt -e .
fi
exec .venv/bin/uvicorn chemmodel.api.main:app --host 127.0.0.1 --port 8000
