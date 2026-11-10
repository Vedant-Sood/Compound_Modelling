#!/usr/bin/env bash
# Build the Chemical Modelling desktop app (Linux AppImage + .deb by default).
#   scripts/build-desktop.sh            # Linux packages into desktop/dist/
#   scripts/build-desktop.sh --dir      # unpacked app only (fast, for testing)
#   scripts/build-desktop.sh --win      # Windows installer (needs Wine when run on Linux;
#                                       #   prefer scripts/build-desktop.ps1 on Windows)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building frontend"
cd "$root/frontend"
[ -d node_modules ] || npm ci
npm run build

echo "==> Installing desktop tooling"
cd "$root/desktop"
[ -d node_modules ] || npm ci
npm test

case "${1:-}" in
  --dir) npx electron-builder --dir ;;
  --win) npx electron-builder --win nsis ;;
  --mac) npx electron-builder --mac dmg ;;
  "") npx electron-builder --linux AppImage deb ;;
  *) echo "unknown option: $1" >&2; exit 64 ;;
esac
echo "==> Output in $root/desktop/dist"
