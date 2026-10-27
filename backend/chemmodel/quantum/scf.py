"""Self-consistent-field electronic structure (Hartree-Fock and Kohn-Sham DFT)
via PySCF, for atoms and molecules.

Everything here is a genuine calculation: the returned densities, orbitals
and potentials are evaluated from the converged SCF density matrix and
molecular-orbital coefficients on real-space grids.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Callable, Sequence

import numpy as np

from chemmodel.units import BOHR_PM, HARTREE_EV

BASIS_SETS = ["sto-3g", "6-31g", "6-31g*", "cc-pvdz", "cc-pvtz", "def2-svp", "def2-tzvp"]
XC_FUNCTIONALS = ["LDA", "PBE", "B3LYP", "PBE0", "wB97X-D"]
# Basis sets that pair with an effective core potential for heavy elements.
ECP_BASES = {"def2-svp", "def2-tzvp"}

Atom = tuple[str, Sequence[float]]  # (symbol, (x, y, z) in Å)


@dataclass
class SCFSettings:
    method: str = "HF"  # "HF" or "DFT"
    xc: str = "PBE0"
    basis: str = "def2-svp"
    charge: int = 0
    spin: int | None = None  # 2S = N_alpha - N_beta; None = lowest consistent
    unrestricted: bool | None = None  # None: restricted for closed shells only
    conv_tol: float = 1e-9
    max_cycle: int = 150

    def validate(self) -> None:
        if self.method not in ("HF", "DFT"):
            raise ValueError("method must be 'HF' or 'DFT'")
        if self.basis.lower() not in BASIS_SETS:
            raise ValueError(f"basis must be one of {BASIS_SETS}")
        if self.method == "DFT" and self.xc not in XC_FUNCTIONALS:
            raise ValueError(f"xc must be one of {XC_FUNCTIONALS}")


@dataclass
class SCFLog:
    cycles: list[dict] = field(default_factory=list)


def build_mol(atoms: Sequence[Atom], settings: SCFSettings):
    from pyscf import gto

    settings.validate()
    basis = settings.basis.lower()
    mol = gto.Mole()
    mol.atom = [(sym, tuple(float(c) for c in xyz)) for sym, xyz in atoms]
    mol.unit = "Angstrom"
    mol.basis = basis
    heavy = any(gto.charge(sym) > 36 for sym, _ in atoms)
    if heavy and basis in ECP_BASES:
        mol.ecp = basis
    mol.charge = settings.charge
    mol.verbose = 0
    # Build once to count electrons, then set the spin.
    mol.spin = 0 if settings.spin is None else settings.spin
    try:
        mol.build()
    except RuntimeError:
        if settings.spin is not None:
            raise
        mol.spin = 1
        mol.build()
    if settings.spin is None and mol.nelectron % 2 != mol.spin % 2:
        mol.spin = mol.nelectron % 2
        mol.build()
    return mol


def make_mf(mol, settings: SCFSettings):
    from pyscf import dft, scf

    open_shell = mol.spin != 0
    unrestricted = settings.unrestricted if settings.unrestricted is not None else open_shell
    if settings.method == "HF":
        mf = scf.UHF(mol) if unrestricted else (scf.ROHF(mol) if open_shell else scf.RHF(mol))
    else:
        mf = dft.UKS(mol) if unrestricted else (dft.ROKS(mol) if open_shell else dft.RKS(mol))
        mf.xc = settings.xc
    mf.conv_tol = settings.conv_tol
    mf.max_cycle = settings.max_cycle
    return mf


def run_scf(
    atoms: Sequence[Atom],
    settings: SCFSettings,
    log: Callable[[str], None] | None = None,
):
    """Run an SCF calculation. Returns (mol, mf, summary_dict)."""
    log = log or (lambda _m: None)
    mol = build_mol(atoms, settings)
    mf = make_mf(mol, settings)
    cycles: list[dict] = []

    def callback(env):
        cycles.append({"cycle": int(env["cycle"]) + 1, "energy_Eh": float(env["e_tot"])})
        log(f"SCF cycle {env['cycle'] + 1}: E = {env['e_tot']:.10f} Eh")

    mf.callback = callback
    log(
        f"{type(mf).__name__} / {settings.basis}"
        + (f" / {settings.xc}" if settings.method == "DFT" else "")
        + f": {mol.nelectron} electrons, {mol.nao} basis functions, 2S = {mol.spin}"
    )
    t0 = time.perf_counter()
    mf.kernel()
    if not mf.converged:
        log("SCF did not converge with DIIS; retrying with second-order (Newton) solver")
        mf = mf.newton()
        mf.callback = callback
        mf.kernel(mf.mo_coeff, mf.mo_occ)
    wall = time.perf_counter() - t0
    log(f"SCF {'converged' if mf.converged else 'NOT converged'}: E = {mf.e_tot:.10f} Eh ({wall:.2f} s)")

    warnings = []
    if not mf.converged:
        warnings.append("SCF did not converge; energies and densities are not reliable.")
    if mol.has_ecp():
        warnings.append(
            "An effective core potential replaces core electrons: densities show valence electrons only."
        )
    s2 = None
    if mol.spin != 0 and hasattr(mf, "spin_square"):
        s2, mult = mf.spin_square()
        exact = 0.5 * mol.spin * (0.5 * mol.spin + 1)
        if abs(s2 - exact) > 0.05:
            warnings.append(f"Spin contamination: <S^2> = {s2:.3f} (exact {exact:.3f}).")

    summary = {
        "engine": "PySCF",
        "engine_version": __import__("pyscf").__version__,
        "solver": type(mf).__name__,
        "settings": asdict(settings),
        "n_electrons": int(mol.nelectron),
        "n_basis_functions": int(mol.nao),
        "spin_2S": int(mol.spin),
        "ecp": bool(mol.has_ecp()),
        "converged": bool(mf.converged),
        "energy_Eh": float(mf.e_tot),
        "energy_eV": float(mf.e_tot * HARTREE_EV),
        "s_squared": None if s2 is None else float(s2),
        "cycles": cycles,
        "wall_time_s": wall,
        "orbitals": orbital_table(mol, mf),
        "dipole_debye": [float(x) for x in mf.dip_moment(verbose=0)],
        "mulliken_charges": [float(x) for x in mf.mulliken_pop(verbose=0)[1]],
        "warnings": warnings,
    }
    gap = homo_lumo_gap(summary["orbitals"])
    summary["homo_lumo_gap_eV"] = gap
    return mol, mf, summary


def _channels(mf):
    """List of (spin label, energies, occupations, coefficients)."""
    e, occ, c = mf.mo_energy, mf.mo_occ, mf.mo_coeff
    if np.ndim(c) == 2:
        return [("restricted", e, np.asarray(occ), c)]
    return [("alpha", e[0], np.asarray(occ[0]), c[0]), ("beta", e[1], np.asarray(occ[1]), c[1])]


def orbital_table(mol, mf) -> list[dict]:
    labels = mol.ao_labels()
    s = mol.intor_symmetric("int1e_ovlp")
    rows = []
    for spin, energies, occ, coeff in _channels(mf):
        for i, (eps, n) in enumerate(zip(energies, occ)):
            c = coeff[:, i]
            weights = c * (s @ c)  # Mulliken AO populations of this orbital
            top = np.argsort(-np.abs(weights))[:3]
            rows.append(
                {
                    "spin": spin,
                    "index": i,
                    "energy_Eh": float(eps),
                    "energy_eV": float(eps * HARTREE_EV),
                    "occupation": float(n),
                    "character": [
                        {"ao": labels[j].strip(), "weight": float(weights[j])} for j in top
                    ],
                }
            )
    return rows


def homo_lumo_gap(orbitals: list[dict]) -> float | None:
    occ = [o["energy_eV"] for o in orbitals if o["occupation"] > 1e-6]
    virt = [o["energy_eV"] for o in orbitals if o["occupation"] <= 1e-6]
    if not occ or not virt:
        return None
    return float(min(virt) - max(occ))


def total_dm(mf) -> np.ndarray:
    dm = mf.make_rdm1()
    return dm[0] + dm[1] if np.ndim(dm) == 3 else dm


def spin_dm(mf) -> np.ndarray | None:
    dm = mf.make_rdm1()
    return dm[0] - dm[1] if np.ndim(dm) == 3 else None


# ---- real-space grids ---------------------------------------------------


@dataclass
class Grid:
    origin_bohr: np.ndarray  # (3,)
    spacing_bohr: float
    shape: tuple[int, int, int]

    def coords(self) -> np.ndarray:
        axes = [self.origin_bohr[i] + self.spacing_bohr * np.arange(self.shape[i]) for i in range(3)]
        g = np.meshgrid(*axes, indexing="ij")
        return np.stack([a.ravel() for a in g], axis=1)

    @property
    def voxel_volume_bohr3(self) -> float:
        return self.spacing_bohr**3

    def describe(self) -> dict:
        return {
            "origin_pm": (self.origin_bohr * BOHR_PM).tolist(),
            "spacing_pm": self.spacing_bohr * BOHR_PM,
            "shape": list(self.shape),
        }


def grid_for(mol, points: int, padding_bohr: float) -> Grid:
    """Cube enclosing all nuclei plus padding, with `points` samples per edge."""
    xyz = mol.atom_coords()
    lo, hi = xyz.min(axis=0) - padding_bohr, xyz.max(axis=0) + padding_bohr
    centre, half = 0.5 * (lo + hi), 0.5 * float((hi - lo).max())
    spacing = 2 * half / (points - 1)
    return Grid(centre - half, spacing, (points, points, points))


def density_on_grid(mol, dm, grid: Grid, chunk: int = 20000) -> np.ndarray:
    from pyscf.dft import numint

    coords = grid.coords()
    out = np.empty(len(coords))
    for start in range(0, len(coords), chunk):
        ao = numint.eval_ao(mol, coords[start : start + chunk])
        out[start : start + chunk] = numint.eval_rho(mol, ao, dm)
    return out.reshape(grid.shape)


def orbital_on_grid(mol, coeff: np.ndarray, grid: Grid, chunk: int = 20000) -> np.ndarray:
    from pyscf.dft import numint

    coords = grid.coords()
    out = np.empty(len(coords))
    for start in range(0, len(coords), chunk):
        ao = numint.eval_ao(mol, coords[start : start + chunk])
        out[start : start + chunk] = ao @ coeff
    return out.reshape(grid.shape)


def esp_on_points(mol, dm, coords_bohr: np.ndarray, chunk: int = 600) -> np.ndarray:
    """Molecular electrostatic potential (hartree / e) at the given points:
    V(r) = sum_A Z_A / |r - R_A| - integral rho(r') / |r - r'| dr'.
    Points closer than 1e-6 bohr to a nucleus are clipped."""
    charges = mol.atom_charges()
    xyz = mol.atom_coords()
    v = np.zeros(len(coords_bohr))
    for a in range(len(charges)):
        d = np.linalg.norm(coords_bohr - xyz[a], axis=1)
        v += charges[a] / np.maximum(d, 1e-6)
    for start in range(0, len(coords_bohr), chunk):
        ints = mol.intor("int1e_grids", grids=coords_bohr[start : start + chunk])
        v[start : start + chunk] -= np.einsum("gij,ij->g", ints, dm)
    return v


def electron_count_on_grid(density: np.ndarray, grid: Grid) -> float:
    """Riemann-sum electron count. Coarse grids under-resolve nuclear cusps,
    so this is a resolution diagnostic, not an accurate integral."""
    return float(density.sum() * grid.voxel_volume_bohr3)
