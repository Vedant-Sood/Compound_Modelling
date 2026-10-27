"""Balanced mode: GFN-xTB semiempirical tight binding via tblite (optional).

GFN2-xTB / GFN1-xTB (Grimme and co-workers) are parameterised for
geometries, frequencies and non-covalent interactions across the periodic
table up to Rn. Energies are method-specific total energies and must not be
compared with HF/DFT energies.
"""

from __future__ import annotations

import time
from typing import Callable

import numpy as np

from chemmodel.molecular.structure import Molecule
from chemmodel.units import HARTREE_EV

BOHR_ANGSTROM = 0.529177210903
AU_TO_DEBYE = 2.541746473
METHODS = ["GFN2-xTB", "GFN1-xTB"]


def available() -> bool:
    try:
        import tblite.interface  # noqa: F401

        return True
    except ImportError:
        return False


def _version() -> str:
    try:
        from importlib.metadata import version

        return version("tblite")
    except Exception:
        from tblite.library import get_version

        return ".".join(map(str, get_version()))


def _calculator(mol: Molecule, method: str, coords_angstrom: np.ndarray):
    from ase.data import atomic_numbers
    from tblite.interface import Calculator

    if method not in METHODS:
        raise ValueError(f"method must be one of {METHODS}")
    numbers = np.array([atomic_numbers[s] for s in mol.symbols])
    if numbers.max() > 86:
        raise ValueError("GFN-xTB is parameterised only up to Rn (Z = 86)")
    calc = Calculator(method, numbers, coords_angstrom / BOHR_ANGSTROM, charge=float(mol.charge), uhf=mol.multiplicity - 1)
    calc.set("verbosity", 0)
    return calc


def singlepoint(mol: Molecule, method: str = "GFN2-xTB", coords: np.ndarray | None = None) -> dict:
    c = mol.coords if coords is None else coords
    t0 = time.perf_counter()
    res = _calculator(mol, method, c).singlepoint()
    eps = np.asarray(res.get("orbital-energies"))
    occ = np.asarray(res.get("orbital-occupations"))
    orbitals = [
        {"spin": "restricted", "index": i, "energy_Eh": float(e), "energy_eV": float(e * HARTREE_EV), "occupation": float(o), "character": []}
        for i, (e, o) in enumerate(zip(eps, occ))
    ]
    occupied = [o["energy_eV"] for o in orbitals if o["occupation"] > 1e-6]
    virtual = [o["energy_eV"] for o in orbitals if o["occupation"] <= 1e-6]
    return {
        "engine": "tblite",
        "engine_version": _version(),
        "solver": method,
        "settings": {"method": method, "charge": mol.charge, "multiplicity": mol.multiplicity},
        "energy_Eh": float(res.get("energy")),
        "gradient_Eh_per_bohr": np.asarray(res.get("gradient")).tolist(),
        "orbitals": orbitals,
        "homo_lumo_gap_eV": (min(virtual) - max(occupied)) if occupied and virtual else None,
        "dipole_debye": (np.asarray(res.get("dipole")) * AU_TO_DEBYE).tolist(),
        "atomic_charges": np.asarray(res.get("charges")).tolist(),
        "charge_model": f"{method} atomic partial charges",
        "wall_time_s": time.perf_counter() - t0,
        "warnings": [
            f"{method} is a semiempirical method: use it for geometries and trends; "
            "its total energy is not comparable with HF/DFT energies."
        ],
    }


def optimise(
    mol: Molecule,
    method: str,
    log: Callable[[str], None],
    fmax_eV_per_A: float = 0.01,
    max_steps: int = 500,
) -> tuple[Molecule, list[dict], bool]:
    """ASE BFGS on the xTB surface using tblite energies and gradients."""
    from ase import Atoms
    from ase.calculators.calculator import Calculator, all_changes
    from ase.optimize import BFGS

    class _XTB(Calculator):
        implemented_properties = ["energy", "forces"]

        def calculate(self, atoms=None, properties=("energy",), system_changes=all_changes):
            super().calculate(atoms, properties, system_changes)
            res = _calculator(mol, method, self.atoms.positions).singlepoint()
            self.results = {
                "energy": float(res.get("energy")) * HARTREE_EV,
                "forces": -np.asarray(res.get("gradient")) * HARTREE_EV / BOHR_ANGSTROM,
            }

    atoms = Atoms(mol.symbols, positions=mol.coords)
    atoms.calc = _XTB()
    steps: list[dict] = []

    def record():
        f = atoms.get_forces()
        e = atoms.get_potential_energy() / HARTREE_EV
        fmax = float(np.sqrt((f**2).sum(axis=1)).max())
        steps.append({"step": len(steps), "energy_Eh": e, "fmax_eV_per_A": fmax, "coords": atoms.positions.tolist()})
        log(f"{method} opt step {len(steps) - 1}: E = {e:.10f} Eh, max force {fmax:.4f} eV/Å")

    opt = BFGS(atoms, logfile=None, maxstep=0.2)
    opt.attach(record, interval=1)
    converged = bool(opt.run(fmax=fmax_eV_per_A, steps=max_steps))
    return Molecule(mol.symbols, atoms.positions.copy(), mol.bonds, mol.charge, mol.multiplicity), steps, converged
