"""Quantum-chemistry job endpoints (submit, poll, cancel, post-process)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from chemmodel.jobs import tasks
from chemmodel.jobs.manager import job_dir, manager
from chemmodel.quantum.scf import BASIS_SETS, XC_FUNCTIONALS

router = APIRouter(prefix="/api", tags=["calculations"])


class SCFRequest(BaseModel):
    atoms: list[tuple[str, tuple[float, float, float]]] = Field(
        ..., description="[[symbol, [x, y, z]], ...] with coordinates in Å"
    )
    method: Literal["HF", "DFT"] = "HF"
    xc: str = "PBE0"
    basis: str = "def2-svp"
    charge: int = 0
    spin: int | None = None
    unrestricted: bool | None = None
    conv_tol: float = 1e-9
    max_cycle: int = 150
    grid_points: int = Field(64, ge=16, le=128)


@router.get("/calc/options")
def calc_options():
    return {
        "methods": ["HF", "DFT"],
        "basis_sets": BASIS_SETS,
        "xc_functionals": XC_FUNCTIONALS,
        "modes": {
            "accurate": "Ab initio HF or DFT with PySCF (available)",
            "balanced": "Semiempirical (GFN-xTB) - optional integration, not installed",
            "fast": "Reference data / force fields - planned",
        },
    }


@router.post("/jobs/scf")
def submit_scf(req: SCFRequest):
    params = req.model_dump()
    params["atoms"] = [[s, list(x)] for s, x in req.atoms]
    try:
        job = manager.submit("scf", params)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return job.to_dict(include_result=False)


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
