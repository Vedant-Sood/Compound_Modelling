# Desktop app

[Project overview](../README.md) · [Documentation index](README.md)

Chemical Modelling ships as a desktop application built with [Electron](https://www.electronjs.org/).
It opens the workstation in its own window, starts the scientific backend for you and stops it
when you quit. No browser or terminal is needed after installation.

## How it works

```
┌────────────── Electron app ──────────────┐
│ splash screen ──► main window (Chromium) │  loads http://127.0.0.1:<random port>
│        │                                 │
│   main process ── spawns ──► run-backend.sh ──► python -m chemmodel.launcher
└──────────────────────────────────────────┘        (FastAPI + PySCF/RDKit/ASE, serves the UI)
```

- The app bundles the built UI (`frontend/dist`), the backend sources (`backend/chemmodel`) and
  `desktop/backend/run-backend.sh`.
- **First launch** creates a Python virtualenv and installs the pinned scientific stack from
  `backend/requirements.txt`. This needs internet access and takes a few minutes; progress is
  shown on the splash screen. Later launches start in seconds. When `requirements.txt` changes
  in a new app version, the environment is updated automatically.
- The backend listens only on `127.0.0.1`, on a free port chosen at start-up. It exits when the
  app closes (the app holds its standard input open; see `backend/chemmodel/launcher.py`).
- Windows: PySCF has no Windows wheels, so the backend runs inside **WSL2**. The app calls
  `wsl.exe`, which runs the same script in your default Linux distribution. WSL2 forwards
  `localhost` to Windows, so the window connects as usual.

| Platform | Python environment location | Package format |
|---|---|---|
| Linux | `~/.config/Chemical Modelling/backend-venv` | AppImage, .deb |
| Windows 11 | `~/.chemmodel/desktop-venv` inside WSL | NSIS installer (.exe) |
| macOS | `~/Library/Application Support/Chemical Modelling/backend-venv` | .dmg (unsigned, untested) |

Logs: **Help → Open Logs Folder** (`<user data>/logs/backend.log`).

## Requirements on the user's machine

- Linux: Python 3.10+ with `venv` (`sudo apt install python3 python3-venv`). The `.deb` declares
  these as dependencies.
- Windows 11: WSL2 with Ubuntu (`wsl --install -d Ubuntu`), then inside Ubuntu
  `sudo apt install python3 python3-venv`. Node.js is **not** needed to run the installed app.
- A GPU/driver with WebGL2 for the volume renderer (same as the browser version).

## Building

The frontend must be built first; the scripts do it for you.

Linux or WSL (produces `desktop/dist/ChemicalModelling-<version>-linux-x86_64.AppImage` and a `.deb`):

```bash
scripts/build-desktop.sh          # AppImage + deb
scripts/build-desktop.sh --dir    # unpacked app in desktop/dist/linux-unpacked (quick test)
```

Windows installer, from PowerShell on Windows (Node.js 20+ for Windows required):

```powershell
.\scripts\build-desktop.ps1       # desktop\dist\ChemicalModelling-<version>-win-x64.exe
```

Building the Windows installer from Linux needs Wine, so build it on Windows. Builds are
unsigned: Windows SmartScreen will warn on first run ("More info → Run anyway") and macOS
Gatekeeper requires right-click → Open. Code signing can be added later through
electron-builder's `CSC_LINK`/`CSC_KEY_PASSWORD` environment variables.

### Running from source (development)

```bash
cd frontend && npm ci && npm run build && cd ..
cd desktop && npm ci && npm start
```

In development the app reuses `backend/.venv` if it exists (created by
`scripts/start-backend.sh`) and does not reinstall anything. To work on the UI with hot reload,
start the backend and Vite yourself and point the app at them:

```bash
CHEMMODEL_BACKEND_URL=http://127.0.0.1:5173 npm start   # in desktop/
```

## Environment variables

| Variable | Effect |
|---|---|
| `CHEMMODEL_BACKEND_URL` | Connect to an already running backend (or Vite dev server) instead of starting one |
| `CHEMMODEL_VENV` | Use this virtualenv path for the backend (Linux/macOS) |
| `CHEMMODEL_BOOTSTRAP_PYTHON` | Interpreter used to create the virtualenv (default `python3`) |
| `CHEMMODEL_WSL_DISTRO` | Windows: WSL distribution to run the backend in (default: WSL's default) |
| `CHEMMODEL_SOFTWARE_GL` | `1` forces software WebGL (SwiftShader) for VMs or blocklisted GPUs; slow |
| `CHEMMODEL_CACHE` | Calculation cache directory (default `~/.chemmodel/cache`), as for the browser version |

## Security model

- The workstation window runs with `contextIsolation`, the Chromium `sandbox` and no Node.js
  integration; it has no preload script, so the web UI has no access to the file system or
  Electron APIs beyond what a normal browser tab has.
- Navigation is restricted to the backend's origin; other links open in the system browser
  (only `http`, `https` and `mailto` URLs). New windows, `<webview>` tags and all permission
  requests (camera, microphone, notifications, …) are denied.
- The splash screen uses a strict Content-Security-Policy and a minimal preload that exposes
  only status events and Retry/Open log/Quit actions.
- The backend binds to `127.0.0.1` only. Like the browser version it is unauthenticated, so other
  programs running as your user on the same machine can reach it while the app is open.

## Troubleshooting

| Symptom | What to do |
|---|---|
| "python3 not found" / "Could not create a virtualenv" | Install `python3` and `python3-venv` (inside WSL on Windows), then press Retry |
| "Could not start WSL" | Install WSL2: `wsl --install -d Ubuntu`, reboot, open Ubuntu once to finish setup |
| First launch fails during `pip install` | Check internet access and the log; press Retry. To start over, delete the venv folder listed above |
| Window opens but 3D views are blank | Check GPU/WebGL2 support and update the graphics driver; as a fallback start the app with `CHEMMODEL_SOFTWARE_GL=1` |
| Port or proxy problems on Windows | Make sure WSL `localhost` forwarding is enabled (default on WSL2) |
