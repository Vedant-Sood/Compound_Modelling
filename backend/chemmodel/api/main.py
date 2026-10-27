"""FastAPI application entry point: `uvicorn chemmodel.api.main:app`."""

from __future__ import annotations

import importlib
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from chemmodel import __version__
from chemmodel.api import atomic, calc, molecular

app = FastAPI(
    title="Chemical Modelling API",
    version=__version__,
    description="Scientific backend: atomic data, analytic orbitals and PySCF electronic structure.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(atomic.router)
app.include_router(calc.router)
app.include_router(molecular.router)

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
