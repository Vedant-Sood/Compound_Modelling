"""Calculation tasks executed by the job manager in worker processes.

Each task receives (params, log, workdir) and returns a JSON-serialisable
dict. Heavy arrays are base64 float32; the SCF checkpoint is kept in
workdir so orbitals and potentials can be evaluated later without
re-running the SCF.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np

from chemmodel.encoding import encode_volume
from chemmodel.quantum import scf as Q

Log = Callable[[str], None]


def _settings(params: dict) -> Q.SCFSettings:
    keys = Q.SCFSettings.__dataclass_fields__.keys()
    return Q.SCFSettings(**{k: params[k] for k in keys if k in params})


def atomic_extent_bohr(mol, dm, fraction: float = 0.999) -> float:
    """Radius of the sphere holding `fraction` of the electrons, from the
    spherically averaged density along 26 directions."""
    from pyscf.dft import numint

    dirs = np.array(
        [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)],
        dtype=float,
    )
    dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    r = np.linspace(1e-4, 25.0, 1500)
    pts = (r[None, :, None] * dirs[:, None, :]).reshape(-1, 3) + mol.atom_coords()[0]
    rho = numint.eval_rho(mol, numint.eval_ao(mol, pts), dm).reshape(len(dirs), len(r)).mean(axis=0)
    p = 4 * np.pi * r**2 * rho
    cdf = np.concatenate([[0], np.cumsum(0.5 * (p[1:] + p[:-1]) * np.diff(r))])
    return float(np.interp(fraction, cdf / cdf[-1], r))


def scf_task(params: dict, log: Log, workdir: Path) -> dict:
    """SCF for an atom or molecule plus total (and spin) density on a grid.

    params: atoms [[symbol, [x, y, z] Å], ...], SCF settings, grid_points.
    """
    atoms = [(a[0], a[1]) for a in params["atoms"]]
    settings = _settings(params)
    points = int(params.get("grid_points", 64))
    if not 16 <= points <= 128:
        raise ValueError("grid_points must be between 16 and 128")
    mol, mf, summary = Q.run_scf(atoms, settings, log)
    chk = workdir / "scf.chk"
    from pyscf.lib import chkfile
    from pyscf.scf import chkfile as scf_chk

    chkfile.save_mol(mol, str(chk))
    scf_chk.dump_scf(mol, str(chk), mf.e_tot, mf.mo_energy, mf.mo_coeff, mf.mo_occ)

    dm = Q.total_dm(mf)
    if len(atoms) == 1:
        padding = atomic_extent_bohr(mol, dm)
        log(f"Grid half-width {padding:.2f} bohr encloses 99.9% of the electrons (spherical average)")
    else:
        padding = float(params.get("padding_bohr", 5.0))
    grid = Q.grid_for(mol, points, padding)
    log(f"Evaluating electron density on a {points}^3 grid")
    rho = Q.density_on_grid(mol, dm, grid)
    volumes = {"density": encode_volume(rho)}
    sdm = Q.spin_dm(mf)
    if sdm is not None:
        volumes["spin_density"] = encode_volume(Q.density_on_grid(mol, sdm, grid))
    summary["grid"] = grid.describe()
    summary["grid"]["riemann_electron_count"] = Q.electron_count_on_grid(rho, grid)
    summary["volumes"] = volumes
    summary["atoms"] = [[s, list(map(float, x))] for s, x in atoms]
    np.save(workdir / "grid.npy", np.array([*grid.origin_bohr, grid.spacing_bohr, points]))
    return summary


TASKS = {"scf": scf_task}


# ---- post-processing from a stored checkpoint (fast, run in the API) -----


def load_checkpoint(workdir: Path):
    from pyscf.scf import chkfile as scf_chk

    mol, data = scf_chk.load_scf(str(workdir / "scf.chk"))
    g = np.load(workdir / "grid.npy")
    grid = Q.Grid(np.array(g[:3]), float(g[3]), (int(g[4]),) * 3)
    return mol, data, grid


def orbital_volume(workdir: Path, spin: str, index: int) -> dict:
    mol, data, grid = load_checkpoint(workdir)
    coeff = np.asarray(data["mo_coeff"])
    energy = np.asarray(data["mo_energy"])
    occ = np.asarray(data["mo_occ"])
    if coeff.ndim == 3:
        ch = {"alpha": 0, "beta": 1}[spin]
        coeff, energy, occ = coeff[ch], energy[ch], occ[ch]
    if not 0 <= index < coeff.shape[1]:
        raise IndexError("orbital index out of range")
    psi = Q.orbital_on_grid(mol, coeff[:, index], grid)
    return {
        "spin": spin,
        "index": index,
        "energy_Eh": float(energy[index]),
        "occupation": float(occ[index]),
        "grid": grid.describe(),
        "volume": encode_volume(psi),
        "quantity": "orbital amplitude (bohr^-3/2), signed",
    }


def esp_volume(workdir: Path) -> dict:
    mol, data, grid = load_checkpoint(workdir)
    coeff, occ = np.asarray(data["mo_coeff"]), np.asarray(data["mo_occ"])
    if coeff.ndim == 3:
        dm = sum((coeff[s] * occ[s]) @ coeff[s].T for s in (0, 1))
    else:
        dm = (coeff * occ) @ coeff.T
    v = Q.esp_on_points(mol, dm, grid.coords()).reshape(grid.shape)
    return {
        "grid": grid.describe(),
        "volume": encode_volume(v),
        "quantity": "electrostatic potential (hartree/e); nuclear singularities clipped at 1e-6 bohr",
        "min": float(v.min()),
        "max": float(v.max()),
    }
