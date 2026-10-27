"""Molecular calculation jobs: quantum geometry optimisation and bond scans."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from chemmodel.molecular.optimize import bond_scan, quantum_optimise
from chemmodel.molecular.structure import Molecule
from chemmodel.quantum import scf as Q

Log = Callable[[str], None]


def _settings(params: dict, mol: Molecule) -> Q.SCFSettings:
    keys = Q.SCFSettings.__dataclass_fields__.keys()
    s = Q.SCFSettings(**{k: params[k] for k in keys if k in params})
    s.charge = mol.charge
    s.spin = mol.multiplicity - 1
    return s


def geomopt_task(params: dict, log: Log, workdir: Path) -> dict:
    """params: molecule (JSON), SCF settings, fmax_eV_per_A, max_steps, grid_points."""
    from chemmodel.jobs.tasks import finalise_scf

    mol = Molecule.from_json(params["molecule"])
    mol.check_spin()
    settings = _settings(params, mol)
    final, steps, calc, converged = quantum_optimise(
        mol, settings, log, float(params.get("fmax_eV_per_A", 0.01)), int(params.get("max_steps", 200))
    )
    log(f"Geometry optimisation {'converged' if converged else 'did NOT converge'} after {len(steps)} steps")
    # Re-run the final SCF through the standard path to get the full summary.
    mol_q, mf, summary = Q.run_scf(final.atoms, settings, log)
    summary = finalise_scf(mol_q, mf, summary, final.atoms, params, log, workdir)
    summary["optimisation"] = {
        "optimiser": "ASE BFGS",
        "fmax_eV_per_A": float(params.get("fmax_eV_per_A", 0.01)),
        "converged": converged,
        "steps": steps,
    }
    summary["molecule"] = final.to_json()
    if not converged:
        summary["warnings"].append("Geometry optimisation did not reach the force threshold.")
    return summary


def scan_task(params: dict, log: Log, workdir: Path) -> dict:
    """params: molecule, i, j, r_min, r_max, points, SCF settings."""
    mol = Molecule.from_json(params["molecule"])
    mol.check_spin()
    settings = _settings(params, mol)
    n = int(params.get("points", 15))
    if not 3 <= n <= 60:
        raise ValueError("points must be between 3 and 60")
    r0, r1 = float(params["r_min"]), float(params["r_max"])
    if not 0.2 <= r0 < r1 <= 10:
        raise ValueError("require 0.2 Å <= r_min < r_max <= 10 Å")
    rs = [r0 + (r1 - r0) * k / (n - 1) for k in range(n)]
    pts = bond_scan(mol, int(params["i"]), int(params["j"]), rs, settings, log)
    best = min(pts, key=lambda p: p["energy_Eh"])
    return {
        "points": pts,
        "bond": [int(params["i"]), int(params["j"])],
        "minimum_on_grid": best,
        "method": f"rigid scan, {settings.method}{'/' + settings.xc if settings.method == 'DFT' else ''}/{settings.basis}",
        "notes": "Only the selected atom moves; other coordinates are not relaxed. "
        "Restricted references dissociate incorrectly for homolytic bond breaking.",
    }


TASKS = {"geomopt": geomopt_task, "scan": scan_task}
