#!/usr/bin/env bash
# Start the Chemical Modelling backend for the desktop shell (Linux, macOS, and inside WSL2).
#
#   run-backend.sh <backend_src> <frontend_dist> <venv_dir> <port>
#
# On first run (or when backend/requirements.txt changes) this creates <venv_dir> and installs
# the pinned scientific stack into it. The backend package itself is not installed: it is
# imported from <backend_src> through PYTHONPATH, so a read-only app bundle works.
# Lines starting with CHEMMODEL_STATUS are shown on the desktop splash screen.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <backend_src> <frontend_dist> <venv_dir> <port>" >&2
  exit 64
fi
SRC=$1
DIST=$2
VENV=$3
PORT=$4
BOOT_PY=${CHEMMODEL_BOOTSTRAP_PYTHON:-python3}
STAMP="$VENV/.chemmodel-requirements.sha256"

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

want=$(hash_file "$SRC/requirements.txt")
have=$(cat "$STAMP" 2>/dev/null || true)

if [ "${CHEMMODEL_SKIP_INSTALL:-0}" = "1" ] && [ -x "$VENV/bin/python" ]; then
  echo "CHEMMODEL_STATUS Using existing environment $VENV"
elif [ ! -x "$VENV/bin/python" ] || [ "$want" != "$have" ]; then
  if ! command -v "$BOOT_PY" >/dev/null 2>&1; then
    echo "CHEMMODEL_ERROR $BOOT_PY not found. Install Python 3.10+ with venv support (Ubuntu: sudo apt install python3 python3-venv)." >&2
    exit 69
  fi
  echo "CHEMMODEL_STATUS Creating Python environment (first run, this can take several minutes)"
  mkdir -p "$(dirname "$VENV")"
  if ! "$BOOT_PY" -m venv "$VENV"; then
    echo "CHEMMODEL_ERROR Could not create a virtualenv. On Ubuntu/WSL install python3-venv: sudo apt install python3-venv" >&2
    exit 69
  fi
  echo "CHEMMODEL_STATUS Installing scientific libraries (PySCF, RDKit, ASE, spglib, ...)"
  "$VENV/bin/python" -m pip install --disable-pip-version-check --upgrade pip
  "$VENV/bin/python" -m pip install --disable-pip-version-check -r "$SRC/requirements.txt"
  echo "$want" > "$STAMP"
fi

echo "CHEMMODEL_STATUS Starting scientific backend"
export PYTHONPATH="$SRC${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONUNBUFFERED=1
exec "$VENV/bin/python" -m chemmodel.launcher --port "$PORT" --frontend "$DIST" --watch-stdin
