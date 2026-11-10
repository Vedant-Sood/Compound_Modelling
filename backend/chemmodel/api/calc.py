"""Quantum-chemistry job endpoints (submit, poll, cancel, post-process)."""

from __future__ import annotations

import math
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from chemmodel.jobs import tasks
from chemmodel.jobs.manager import TooManyJobs, job_dir, manager
from chemmodel.quantum.scf import BASIS_SETS, XC_FUNCTIONALS

router = APIRouter(prefix="/api", tags=["calculations"])


class SCFRequest(BaseModel):
    atoms: list[tuple[str, tuple[float, float, float]]] = Field(
        ..., max_length=500, description="[[symbol, [x, y, z]], ...] with coordinates in Å"
    )
    method: Literal["HF", "DFT"] = "HF"
    xc: str = Field("PBE0", max_length=32)
    basis: str = Field("def2-svp", max_length=32)
    charge: int = Field(0, ge=-50, le=200)
    spin: int | None = Field(None, ge=0, le=100)
    unrestricted: bool | None = None
    conv_tol: float = Field(1e-9, ge=1e-14, le=1e-3)
    max_cycle: int = Field(150, ge=1, le=1000)
    grid_points: int = Field(64, ge=16, le=128)


@router.get("/calc/options")
def calc_options():
    return {
        "methods": ["HF", "DFT"],
        "basis_sets": BASIS_SETS,
        "xc_functionals": XC_FUNCTIONALS,
        "modes": {
            "accurate": "Ab initio HF or DFT with PySCF (available)",
            "balanced": "Semiempirical GFN2-/GFN1-xTB via tblite (optional; molecular workspace)",
            "fast": "Reference data / force fields - planned",
        },
    }


def submit_job(kind: str, params: dict) -> dict:
    """Queue a job, mapping manager errors to HTTP errors (422 bad input, 429 busy)."""
    try:
        return manager.submit(kind, params).to_dict(include_result=False)
    except TooManyJobs as exc:
        raise HTTPException(429, str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


def preflight_scf(atoms: list, params: dict) -> None:
    """Reject impossible inputs before a job is queued (instead of failing inside it):
    unknown basis/element combinations, zero electrons, impossible spin."""
    from ase.data import atomic_numbers

    from chemmodel.quantum import scf as Q

    unknown = sorted({str(a[0]) for a in atoms if atomic_numbers.get(str(a[0]), 0) == 0})
    if unknown:
        raise HTTPException(422, f"unknown element symbol(s): {', '.join(unknown)}")
    if not atoms:
        raise HTTPException(422, "no atoms given")
    if not all(math.isfinite(float(x)) for a in atoms for x in a[1]):
        raise HTTPException(422, "atom coordinates must be finite numbers")
    try:
        mol = Q.build_mol([(a[0], a[1]) for a in atoms], tasks._settings(params))
    except (RuntimeError, ValueError, KeyError) as exc:
        msg = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        if "spin" in msg.lower() or "electron" in msg.lower():
            msg = f"spin 2S = {params.get('spin')} is impossible for this electron count ({msg})"
        raise HTTPException(422, msg) from exc
    if mol.nelectron < 1:
        raise HTTPException(422, "this species has no electrons, so there is nothing to calculate")


@router.post("/jobs/scf")
def submit_scf(req: SCFRequest):
    params = req.model_dump()
    params["atoms"] = [[s, list(x)] for s, x in req.atoms]
    preflight_scf(params["atoms"], params)
    return submit_job("scf", params)


@router.get("/jobs")
def list_jobs():
    return {"jobs": manager.list()}


def _job(job_id: str):
    try:
        return manager.get(job_id)
    except KeyError as exc:
        raise HTTPException(404, f"no job {job_id}") from exc


@router.get("/jobs/{job_id}")
def job_status(job_id: str, include_result: bool = True):
    return _job(job_id).to_dict(include_result=include_result)


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str):
    return manager.cancel(_job(job_id).id).to_dict(include_result=False)


def _done_dir(job_id: str):
    job = _job(job_id)
    if job.state != "done":
        raise HTTPException(409, f"job is {job.state}")
    return job_dir(job_id)


@router.get("/jobs/{job_id}/orbital")
def job_orbital(job_id: str, index: int, spin: Literal["restricted", "alpha", "beta"] = "restricted"):
    try:
        return tasks.orbital_volume(_done_dir(job_id), spin, index)
    except (IndexError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/jobs/{job_id}/esp")
def job_esp(job_id: str):
    return tasks.esp_volume(_done_dir(job_id))
