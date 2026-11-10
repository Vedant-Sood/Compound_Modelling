# Installation and development

[Project overview](../README.md) · [Documentation index](README.md)

The frontend is React/TypeScript with Three.js. The backend is Python/FastAPI
with scientific engines including PySCF and RDKit.

Use Git, Python with venv support, and Node.js/npm compatible with the committed
frontend lockfile. The backend declares Python >=3.10; individual pinned
scientific packages may require a newer compatible interpreter.
The provided Windows launcher runs the scientific backend in WSL2 Ubuntu.

## Fresh Linux or WSL2 setup

~~~bash
git clone https://github.com/Vedant-Sood/Compound_Modelling.git
cd Compound_Modelling
cd frontend
npm ci
npm run build
cd ..
bash scripts/start-backend.sh
~~~

The backend script creates backend/.venv and installs requirements plus the
editable backend package on its first run. It then serves the API and built UI
at http://127.0.0.1:8000. Leave that process running.

If backend/.venv already exists, the launcher skips installation. To install
or repair dependencies explicitly from the repository root:

~~~bash
backend/.venv/bin/python -m pip install -r backend/requirements.txt -e ./backend
~~~

The pinned requirements include tblite. The package metadata also offers an
optional xtb extra for the balanced semiempirical mode. Without a working
tblite engine, that mode is unavailable; the other methods remain separate.

## Desktop app

To build a desktop executable instead of using the browser, see [DESKTOP.md](DESKTOP.md).

## Windows

Install and configure WSL2 Ubuntu and its Python/venv tools, and install Node/npm
on Windows for the launcher. From the repository root in PowerShell:

~~~powershell
./scripts/start-windows.ps1
~~~

The script builds the frontend, starts the backend inside WSL and opens
http://localhost:8000. The browser can open before a first dependency install
has finished; wait for the backend's startup message and reload.
A native Windows Python environment is not the backend path documented here.

## Development with hot reload

After the backend environment is installed, use two terminals.

Backend, from the repository root:

~~~bash
source backend/.venv/bin/activate
cd backend
uvicorn chemmodel.api.main:app --reload --host 127.0.0.1 --port 8000
~~~

Frontend, from the repository root in another terminal:

~~~bash
cd frontend
npm ci
npm run dev
~~~

Open the frontend URL printed by Vite, normally http://localhost:5173.
Its /api requests proxy to the backend on port 8000.
The API reference is http://127.0.0.1:8000/docs; the engine inventory is
http://127.0.0.1:8000/api/health.

## Existing checks

From the repository root:

~~~bash
backend/.venv/bin/python -m pytest backend/tests
cd frontend
npm test
npm run typecheck
~~~

Use [VALIDATION.md](VALIDATION.md) for the scientific comparisons and recorded
results. This documentation update does not claim those calculations were
rerun.

## Common problems

| Symptom | Check |
| --- | --- |
| Cannot import chemmodel | Install the editable backend package and use backend/.venv |
| API responds but no application page | Build frontend/dist before starting the backend, then restart it |
| Browser cannot reach the backend | Check the terminal for failed dependency installation or a port conflict |
| Balanced mode unavailable | Check the tblite entry from /api/health and the selected environment |
| Volume rendering is degraded | Check the browser's WebGL support and the renderer limitations |
| Crystal or alloy workspace unavailable | These phases are planned; see ROADMAP.md |
