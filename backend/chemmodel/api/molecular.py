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
    i: int = Field(..., ge=0)
    j: int = Field(..., ge=0)
    r_min: float = Field(..., gt=0)
    r_max: float = Field(..., gt=0)
    points: int = Field(15, ge=2, le=60)


def _mol(m: MoleculeIn, check_spin: bool = True) -> S.Molecule:
    """Structural operations (analysis, hydrogens, force field) accept any
    multiplicity while a structure is being drawn; quantum jobs check it."""
    try:
        mol = S.Molecule.from_json(m.model_dump())
        if check_spin:
            mol.check_spin()
        return mol
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/examples")
def examples():
    return {"examples": S.EXAMPLES}


@router.get("/display-data")
def display_data():
    """Covalent radii (Cordero et al. 2008, via ASE) and Jmol colours for drawing atoms."""
    from ase.data import chemical_symbols, covalent_radii
    from ase.data.colors import jmol_colors

    return {
        "covalent_radius_angstrom": {s: float(covalent_radii[z]) for z, s in enumerate(chemical_symbols) if z},
        "colour": {
            s: "#%02x%02x%02x" % tuple(int(round(255 * c)) for c in jmol_colors[z])
            for z, s in enumerate(chemical_symbols)
            if z and z < len(jmol_colors)
        },
        "source": "ase.data (covalent radii: Cordero et al., Dalton Trans. 2008; colours: Jmol convention)",
    }


@router.post("/add-hydrogens")
def add_hydrogens(m: MoleculeIn):
    """Saturate open valences with hydrogens placed by RDKit (coordinates estimated)."""
    from rdkit import Chem

    mol = _mol(m, check_spin=False)
    if not mol.bonds and len(mol.symbols) > 1:
        mol.bonds = _perceived_bonds(mol)
    rd = S.to_rdkit(mol)
    for a in rd.GetAtoms():
        a.SetNoImplicit(False)
        a.SetNumRadicalElectrons(0)
    try:
        Chem.SanitizeMol(rd)
    except Exception as exc:
        raise HTTPException(422, f"cannot add hydrogens: {exc}") from exc
    rd = Chem.AddHs(rd, addCoords=True)
    out = S.from_rdkit(rd, charge=mol.charge, multiplicity=1)
    out.multiplicity = 1 if out.n_electrons % 2 == 0 else 2
    return {"molecule": out.to_json(), "added": len(out.symbols) - len(mol.symbols)}


@router.post("/from-smiles")
def from_smiles(body: dict):
    smiles = str(body.get("smiles", "")).strip()
    if not smiles:
        raise HTTPException(422, "enter a SMILES string")
    try:
        mol, info = S.from_smiles(smiles)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"molecule": mol.to_json(), **info, "analysis": S.perceive(mol)}


@router.post("/analyze")
def analyze(m: MoleculeIn, perceive_bonds: bool = False):
    mol = _mol(m, check_spin=False)
    note = None
    if (perceive_bonds or not mol.bonds) and len(mol.symbols) > 1:
        try:
            rd = S.to_rdkit(S.Molecule(mol.symbols, mol.coords, [], mol.charge, mol.multiplicity), perceive_bonds=True)
            mol.bonds = S.bonds_from_rdkit(rd)
        except Exception as exc:  # RDKit cannot always assign bond orders
            if perceive_bonds:  # explicitly requested: report it
                raise HTTPException(422, str(exc).splitlines()[0]) from exc
            note = f"No bonds drawn and none could be perceived ({str(exc).splitlines()[0]})."
    info = S.perceive(mol)
    if note:
        info["problems"] = [note] + [p for p in info["problems"] if "bond perception" not in p]
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
    mol = _mol(m, check_spin=False)
    if not mol.bonds and len(mol.symbols) > 1:
        mol.bonds = _perceived_bonds(mol)
    try:
        return force_field_optimise(mol)
    except Exception as exc:  # RDKit force-field setup raises several exception types
        raise HTTPException(422, f"force-field clean-up failed: {str(exc).splitlines()[0] if str(exc) else type(exc).__name__}") from exc


def _perceived_bonds(mol: S.Molecule) -> list[tuple[int, int, float]]:
    try:
        return S.bonds_from_rdkit(S.to_rdkit(mol, perceive_bonds=True))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _quantum_preflight(mol: S.Molecule, body: QuantumIn) -> None:
    from chemmodel.api.calc import preflight_scf

    preflight_scf(mol.atoms, {**body.model_dump(exclude={"molecule"}), "charge": mol.charge, "spin": mol.multiplicity - 1})


def _submit(kind: str, body: QuantumIn):
    _quantum_preflight(_mol(body.molecule), body)
    params = body.model_dump()
    params["molecule"]["atoms"] = [{"symbol": a["symbol"], "xyz": list(a["xyz"])} for a in params["molecule"]["atoms"]]
    try:
        return manager.submit(kind, params).to_dict(include_result=False)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs/scf")
def submit_scf(body: QuantumIn):
    mol = _mol(body.molecule)
    _quantum_preflight(mol, body)
    params = body.model_dump(exclude={"molecule"})
    params["atoms"] = [[s, x] for s, x in mol.atoms]
    params["charge"] = mol.charge
    params["spin"] = mol.multiplicity - 1
    try:
        return manager.submit("scf", params).to_dict(include_result=False)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


class XTBIn(BaseModel):
    molecule: MoleculeIn
    method: Literal["GFN2-xTB", "GFN1-xTB"] = "GFN2-xTB"
    optimise: bool = False
    fmax_eV_per_A: float = Field(0.01, gt=0, le=1)


@router.post("/jobs/xtb")
def submit_xtb(body: XTBIn):
    from chemmodel.molecular import xtb

    if not xtb.available():
        raise HTTPException(501, "Balanced mode needs the optional tblite package (pip install tblite).")
    _mol(body.molecule)
    params = body.model_dump()
    params["molecule"]["atoms"] = [{"symbol": a["symbol"], "xyz": list(a["xyz"])} for a in params["molecule"]["atoms"]]
    try:
        return manager.submit("xtb", params).to_dict(include_result=False)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/jobs/geomopt")
def submit_geomopt(body: GeomOptIn):
    return _submit("geomopt", body)


@router.post("/jobs/scan")
def submit_scan(body: ScanIn):
    n = len(body.molecule.atoms)
    if body.i == body.j or body.i >= n or body.j >= n:
        raise HTTPException(422, f"scan needs two different atoms with indices below {n}")
    if body.r_min >= body.r_max:
        raise HTTPException(422, "r_min must be smaller than r_max")
    return _submit("scan", body)
