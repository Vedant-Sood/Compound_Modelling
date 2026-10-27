"""Molecular Builder endpoints."""

from __future__ import annotations

from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from chemmodel.jobs.manager import manager
from chemmodel.molecular import structure as S
from chemmodel.molecular.optimize import force_field_optimise

router = APIRouter(prefix="/api/molecule", tags=["molecular"])


class AtomIn(BaseModel):
    symbol: str
    xyz: tuple[float, float, float]


class BondIn(BaseModel):
    i: int
    j: int
    order: float = 1


class MoleculeIn(BaseModel):
    atoms: list[AtomIn] = Field(..., min_length=1, max_length=500)
    bonds: list[BondIn] = []
    charge: int = 0
    multiplicity: int = Field(1, ge=1, le=11)


class QuantumIn(BaseModel):
    molecule: MoleculeIn
    method: Literal["HF", "DFT"] = "HF"
    xc: str = "B3LYP"
    basis: str = "6-31g*"
    unrestricted: bool | None = None
    grid_points: int = Field(64, ge=16, le=128)
    padding_bohr: float = Field(5.0, ge=2, le=12)


class GeomOptIn(QuantumIn):
    fmax_eV_per_A: float = Field(0.01, gt=0, le=1)
    max_steps: int = Field(200, ge=1, le=1000)


class ScanIn(QuantumIn):
    i: int
    j: int
    r_min: float
    r_max: float
    points: int = 15


def _mol(m: MoleculeIn) -> S.Molecule:
    try:
        mol = S.Molecule.from_json(m.model_dump())
        mol.check_spin()
        return mol
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/examples")
def examples():
    return {"examples": S.EXAMPLES}


@router.post("/from-smiles")
def from_smiles(body: dict):
    try:
        mol, info = S.from_smiles(str(body.get("smiles", "")))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"molecule": mol.to_json(), **info, "analysis": S.perceive(mol)}


@router.post("/analyze")
def analyze(m: MoleculeIn, perceive_bonds: bool = False):
    mol = _mol(m)
    if perceive_bonds or not mol.bonds:
        try:
            rd = S.to_rdkit(S.Molecule(mol.symbols, mol.coords, [], mol.charge, mol.multiplicity), perceive_bonds=True)
            mol.bonds = S.bonds_from_rdkit(rd)
        except Exception as exc:  # RDKit cannot always assign bond orders
            raise HTTPException(422, f"bond perception failed: {exc}") from exc
    info = S.perceive(mol)
    return {
        "molecule": mol.to_json(),
        "analysis": info,
        "geometry": S.geometry_report(mol, mol.bonds),
        "centre_of_mass_angstrom": _com(mol),
    }


def _com(mol: S.Molecule) -> list[float]:
    from ase.data import atomic_masses, atomic_numbers

    w = np.array([atomic_masses[atomic_numbers[s]] for s in mol.symbols])
    return ((w[:, None] * mol.coords).sum(0) / w.sum()).tolist()


@router.post("/forcefield-optimize")
def forcefield_optimize(m: MoleculeIn):
    mol = _mol(m)
    if not mol.bonds:
        mol.bonds = S.bonds_from_rdkit(S.to_rdkit(mol, perceive_bonds=True))
    try:
        return force_field_optimise(mol)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _submit(kind: str, body: QuantumIn):
    _mol(body.molecule)
    params = body.model_dump()
    params["molecule"]["atoms"] = [{"symbol": a["symbol"], "xyz": list(a["xyz"])} for a in params["molecule"]["atoms"]]
    try:
        return manager.submit(kind, params).to_dict(include_result=False)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs/scf")
def submit_scf(body: QuantumIn):
    mol = _mol(body.molecule)
    params = body.model_dump(exclude={"molecule"})
    params["atoms"] = [[s, x] for s, x in mol.atoms]
    params["charge"] = mol.charge
    params["spin"] = mol.multiplicity - 1
    try:
        return manager.submit("scf", params).to_dict(include_result=False)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs/geomopt")
def submit_geomopt(body: GeomOptIn):
    return _submit("geomopt", body)


@router.post("/jobs/scan")
def submit_scan(body: ScanIn):
    return _submit("scan", body)
