"""Geometry optimisation and potential-energy scans.

Fast mode: MMFF94 (or UFF) force field through RDKit.
Accurate mode: PySCF HF/DFT analytic gradients driven by the ASE BFGS
optimiser. Both report every step so convergence can be inspected.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from chemmodel.molecular.structure import Molecule, to_rdkit
from chemmodel.quantum import scf as Q
from chemmodel.units import HARTREE_EV

BOHR_ANGSTROM = 0.529177210903


def force_field_optimise(mol: Molecule, max_iters: int = 2000) -> dict:
    """Minimise with MMFF94 (UFF when MMFF lacks parameters). Energies in kcal/mol
    are force-field steric energies: only differences between conformers of the
    same molecule are meaningful."""
    from rdkit.Chem import AllChem

    m = to_rdkit(mol)
    if AllChem.MMFFHasAllMoleculeParams(m):
        props = AllChem.MMFFGetMoleculeProperties(m)
        ff = AllChem.MMFFGetMoleculeForceField(m, props)
        name = "MMFF94"
    elif AllChem.UFFHasAllMoleculeParams(m):
        ff = AllChem.UFFGetMoleculeForceField(m)
        name = "UFF"
    else:
        raise ValueError("no force-field parameters for this molecule (MMFF94 and UFF both unavailable)")
    e0 = ff.CalcEnergy()
    ff.Initialize()
    status = ff.Minimize(maxIts=max_iters)
    e1 = ff.CalcEnergy()
    pos = np.array(ff.Positions()).reshape(-1, 3)
    out = Molecule(mol.symbols, pos, mol.bonds, mol.charge, mol.multiplicity)
    return {
        "molecule": out.to_json(),
        "method": name,
        "converged": status == 0,
        "initial_energy_kcal_mol": e0,
        "final_energy_kcal_mol": e1,
        "notes": "Force-field steric energy; compare only conformers of the same molecule with the same force field.",
    }


class PySCFCalculator:
    """Minimal ASE-compatible calculator wrapping PySCF energy + gradient."""

    implemented_properties = ["energy", "forces"]

    def __init__(self, settings: Q.SCFSettings, log: Callable[[str], None]):
        self.settings = settings
        self.log = log
        self.last_mf = None
        self.last_mol = None
        self._dm0 = None
        self._cache_key = None
        self._results: dict = {}

    def _compute(self, atoms):
        key = atoms.positions.tobytes()
        if key == self._cache_key:
            return
        geom = list(zip(atoms.get_chemical_symbols(), atoms.positions.tolist()))
        mol = Q.build_mol(geom, self.settings)
        mf = Q.make_mf(mol, self.settings)
        mf.kernel(dm0=self._dm0) if self._dm0 is not None else mf.kernel()
        if not mf.converged:
            mf = mf.newton()
            mf.kernel()
        if not mf.converged:
            raise RuntimeError("SCF failed to converge during geometry optimisation")
        grad = mf.nuc_grad_method().kernel()  # Eh / bohr
        self._dm0 = mf.make_rdm1()
        self.last_mf, self.last_mol = mf, mol
        self._results = {
            "energy": mf.e_tot * HARTREE_EV,
            "forces": -np.asarray(grad) * HARTREE_EV / BOHR_ANGSTROM,
        }
        self._cache_key = key

    # ASE calculator protocol
    def get_potential_energy(self, atoms=None, force_consistent=False):
        self._compute(atoms)
        return self._results["energy"]

    def get_forces(self, atoms=None):
        self._compute(atoms)
        return self._results["forces"].copy()

    def get_property(self, name, atoms=None, allow_calculation=True):
        self._compute(atoms)
        return self._results[name]

    def calculation_required(self, atoms, properties):
        return atoms.positions.tobytes() != self._cache_key

    def check_state(self, atoms, tol=1e-15):
        return [] if atoms.positions.tobytes() == self._cache_key else ["positions"]


def quantum_optimise(
    mol: Molecule,
    settings: Q.SCFSettings,
    log: Callable[[str], None],
    fmax_eV_A: float = 0.01,
    max_steps: int = 200,
) -> tuple[Molecule, list[dict], PySCFCalculator, bool]:
    """BFGS optimisation on the HF/DFT surface. fmax in eV/Å (0.01 ≈ 1.9e-4 Eh/bohr)."""
    from ase import Atoms
    from ase.optimize import BFGS

    atoms = Atoms(mol.symbols, positions=mol.coords)
    calc = PySCFCalculator(settings, log)
    atoms.calc = calc
    steps: list[dict] = []

    def record():
        f = atoms.get_forces()
        e = atoms.get_potential_energy()
        fmax = float(np.sqrt((f**2).sum(axis=1)).max())
        steps.append(
            {"step": len(steps), "energy_Eh": e / HARTREE_EV, "fmax_eV_per_A": fmax, "coords": atoms.positions.tolist()}
        )
        log(f"Opt step {len(steps) - 1}: E = {e / HARTREE_EV:.10f} Eh, max force {fmax:.4f} eV/Å")

    opt = BFGS(atoms, logfile=None, maxstep=0.2)
    opt.attach(record, interval=1)
    converged = bool(opt.run(fmax=fmax_eV_A, steps=max_steps))
    out = Molecule(mol.symbols, atoms.positions.copy(), mol.bonds, mol.charge, mol.multiplicity)
    return out, steps, calc, converged


def bond_scan(
    mol: Molecule,
    i: int,
    j: int,
    distances: list[float],
    settings: Q.SCFSettings,
    log: Callable[[str], None],
) -> list[dict]:
    """Rigid scan: move atom j (and nothing else) along the i-j axis.
    Gives the bond-energy curve E(r); no relaxation of other coordinates."""
    axis = mol.coords[j] - mol.coords[i]
    axis /= np.linalg.norm(axis)
    points = []
    dm0 = None
    for r in distances:
        coords = mol.coords.copy()
        coords[j] = coords[i] + axis * r
        m = Q.build_mol(list(zip(mol.symbols, coords.tolist())), settings)
        mf = Q.make_mf(m, settings)
        mf.kernel(dm0=dm0) if dm0 is not None else mf.kernel()
        dm0 = mf.make_rdm1()
        points.append({"r_angstrom": float(r), "energy_Eh": float(mf.e_tot), "converged": bool(mf.converged)})
        log(f"Scan r = {r:.4f} Å: E = {mf.e_tot:.10f} Eh{'' if mf.converged else ' (NOT converged)'}")
    return points
