"""Crystal Explorer endpoints (periodic structures, symmetry, coordination, defects)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from chemmodel.crystal import analysis as A
from chemmodel.crystal import defects as D
from chemmodel.crystal import symmetry as Y
from chemmodel.crystal.structures import REFERENCE_STRUCTURES, Structure, build_reference, from_cellpar

router = APIRouter(prefix="/api/crystal", tags=["crystal"])


class StructureIn(BaseModel):
    cell: list[list[float]]
    species: list[str] = Field(..., min_length=1, max_length=20000)
    frac_coords: list[list[float]]
    pbc: list[bool] = [True, True, True]


def _s(m: StructureIn) -> Structure:
    try:
        return Structure.from_json(m.model_dump())
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


def _report(s: Structure, symprec: float = 1e-3, tolerance: float = 0.1) -> dict:
    """Everything the workspace shows about a structure, each with its method."""
    from ase.geometry import cell_to_cellpar

    try:
        sym = Y.analyse(s, symprec)
    except ValueError as exc:
        sym = {"error": str(exc)}
    a, b, c, al, be, ga = cell_to_cellpar(s.cell)
    counts: dict[str, int] = {}
    for x in s.species:
        counts[x] = counts.get(x, 0) + 1
    return {
        "structure": s.to_json(),
        "n_atoms": len(s.species),
        "composition": counts,
        "lattice": {"a": a, "b": b, "c": c, "alpha": al, "beta": be, "gamma": ga,
                    "volume_angstrom3": float(abs(__import__("numpy").linalg.det(s.cell)))},
        "density_g_cm3": {"value": A.density_g_cm3(s), "method": "mass of cell contents (standard atomic weights) / cell volume"},
        "symmetry": sym,
        "coordination": A.coordination(s, tolerance),
        "coordination_method": f"first shell = neighbours within (1 + {tolerance}) × nearest distance, periodic images included (ASE neighbour list)",
    }


@router.get("/examples")
def examples():
    return {"examples": {k: {"source": v["source"], "kind": v["kind"], "spacegroup": v["spacegroup"], "cellpar": v["cellpar"]}
                         for k, v in REFERENCE_STRUCTURES.items()}}


class BuildIn(BaseModel):
    name: str | None = None  # reference structure
    cellpar: list[float] | None = None  # a, b, c Å, α, β, γ °
    species: list[str] | None = None
    frac_coords: list[list[float]] | None = None
    spacegroup: int | None = Field(None, ge=1, le=230)


@router.post("/build")
def build(body: BuildIn):
    try:
        hypothetical = True
        if body.name:
            s = build_reference(body.name, body.cellpar)
            note = REFERENCE_STRUCTURES[body.name]["source"]
            hypothetical = bool(body.cellpar) and list(body.cellpar) != list(REFERENCE_STRUCTURES[body.name]["cellpar"])
            if hypothetical:
                note = "Lattice parameters edited by the user (hypothetical structure); reference: " + note
        else:
            if not (body.cellpar and body.species and body.frac_coords):
                raise ValueError("give a reference name, or cellpar + species + frac_coords")
            s = from_cellpar(body.cellpar, body.species, body.frac_coords, body.spacegroup)
            note = "User-defined structure"
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {**_report(s), "provenance": note, "hypothetical": hypothetical}


class AnalyseIn(BaseModel):
    structure: StructureIn
    symprec: float = Field(1e-3, gt=0, le=0.5)
    tolerance: float = Field(0.1, ge=0, le=0.5)


@router.post("/analyse")
def analyse(body: AnalyseIn):
    return _report(_s(body.structure), body.symprec, body.tolerance)


class CellIn(BaseModel):
    structure: StructureIn
    kind: str = Field("primitive", pattern="^(primitive|conventional)$")
    symprec: float = Field(1e-3, gt=0, le=0.5)


@router.post("/standardise")
def standardise(body: CellIn):
    try:
        s = Y.standardise(_s(body.structure), body.kind == "primitive", body.symprec)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _report(s, body.symprec)


class SupercellIn(BaseModel):
    structure: StructureIn
    repeats: tuple[int, int, int] = (2, 2, 2)


@router.post("/supercell")
def supercell(body: SupercellIn):
    try:
        s = A.supercell(_s(body.structure), body.repeats)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _report(s)


class DisplayIn(BaseModel):
    structure: StructureIn
    repeats: tuple[int, int, int] = (1, 1, 1)
    boundary: bool = True
    tolerance: float = Field(0.1, ge=0, le=0.5)


@router.post("/display")
def display(body: DisplayIn):
    try:
        return A.display_geometry(_s(body.structure), body.repeats, body.boundary, body.tolerance)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class SiteIn(BaseModel):
    structure: StructureIn
    index: int = Field(..., ge=0)
    tolerance: float = Field(0.1, ge=0, le=0.5)


@router.post("/site")
def site(body: SiteIn):
    s = _s(body.structure)
    if body.index >= len(s.species):
        raise HTTPException(422, "site index out of range")
    nb = A.neighbours(s)[body.index]
    return {
        "index": body.index,
        "species": s.species[body.index],
        "frac": s.frac[body.index].tolist(),
        "coordination": A.coordination(s, body.tolerance)[body.index],
        "bond_angles_deg": A.bond_angles(s, body.index, body.tolerance),
        "neighbours": [{"index": j, "species": s.species[j], "distance_angstrom": d, "image": img.tolist()} for j, d, img in nb[:24]],
    }


class PlaneIn(BaseModel):
    structure: StructureIn
    hkl: tuple[int, int, int]


@router.post("/plane")
def plane(body: PlaneIn):
    try:
        return A.miller_plane(_s(body.structure), body.hkl)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class DefectIn(BaseModel):
    structure: StructureIn
    kind: str = Field(..., pattern="^(vacancy|substitution|interstitial)$")
    index: int | None = None
    species: str | None = None
    frac: list[float] | None = None


@router.post("/defect")
def defect(body: DefectIn):
    s = _s(body.structure)
    try:
        if body.kind == "vacancy":
            out = D.vacancy(s, _need(body.index, "index"))
        elif body.kind == "substitution":
            out = D.substitution(s, _need(body.index, "index"), _need(body.species, "species"))
        else:
            out = D.interstitial(s, _need(body.species, "species"), _need(body.frac, "frac"))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {**_report(out), "provenance": f"Hypothetical {body.kind} (unrelaxed; not an experimental or computed structure)", "hypothetical": True}


def _need(v, name: str):
    if v is None:
        raise ValueError(f"{name} is required for this defect")
    return v
