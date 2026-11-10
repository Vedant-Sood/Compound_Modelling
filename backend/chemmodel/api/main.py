"""FastAPI application entry point: `uvicorn chemmodel.api.main:app`."""

from __future__ import annotations

import importlib
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from chemmodel import __version__
from chemmodel.api import atomic, calc, crystal, molecular

app = FastAPI(
    title="Chemical Modelling API",
    version=__version__,
    description="Scientific backend: atomic data, analytic orbitals and PySCF electronic structure.",
)


def _env_list(name: str) -> list[str]:
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


# The API is meant for the local machine only. Rejecting any other Host header blocks
# DNS-rebinding attacks, where a web page on an attacker's domain re-resolves that domain
# to 127.0.0.1 and then talks to this server as if it were same-origin.
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", *_env_list("CHEMMODEL_ALLOWED_HOSTS")]
# Only the Vite dev server (and origins the desktop shell adds) may call the API cross-origin.
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", *_env_list("CHEMMODEL_CORS_ORIGINS")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    return response
app.include_router(atomic.router)
app.include_router(calc.router)
app.include_router(molecular.router)
app.include_router(crystal.router)

OPTIONAL_ENGINES = ["numpy", "scipy", "pyscf", "ase", "spglib", "pymatgen.core", "rdkit", "tblite"]


@app.get("/api/health")
def health():
    engines = {}
    for name in OPTIONAL_ENGINES:
        try:
            mod = importlib.import_module(name)
            engines[name] = getattr(mod, "__version__", "installed")
        except ImportError:
            engines[name] = None
    return {"status": "ok", "version": __version__, "engines": engines}


# Serve the built frontend when present (single-process local install).
_dist = Path(os.environ.get("CHEMMODEL_FRONTEND", Path(__file__).resolve().parents[3] / "frontend" / "dist"))
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
