"""Molecule model, chemical perception (RDKit) and geometry measurements.

A molecule is exchanged as JSON::

    {"atoms": [{"symbol": "O", "xyz": [x, y, z]}, ...],   # Å
     "bonds": [{"i": 0, "j": 1, "order": 1}, ...],         # optional
     "charge": 0, "multiplicity": 1}

Bond orders are the user's (or RDKit's) Lewis-structure description. They
are used for chemical perception and the MMFF force field; quantum
calculations only use atoms, charge and spin.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

BOND_TYPES = {1: "SINGLE", 2: "DOUBLE", 3: "TRIPLE", 1.5: "AROMATIC"}
# Closer than this, two nuclei are certainly a drawing mistake (shortest real bond, H2, is 0.74 Å).
MIN_SEPARATION_ANGSTROM = 0.3


@dataclass
class Molecule:
    symbols: list[str]
    coords: np.ndarray  # (n, 3) Å
    bonds: list[tuple[int, int, float]] = field(default_factory=list)
    charge: int = 0
    multiplicity: int = 1

    @classmethod
    def from_json(cls, d: dict) -> "Molecule":
        atoms = d.get("atoms") or []
        if not atoms:
            raise ValueError("molecule has no atoms")
        from ase.data import atomic_numbers

        symbols = [str(a["symbol"]).strip().capitalize() for a in atoms]
        unknown = sorted({s for s in symbols if atomic_numbers.get(s, 0) == 0})
        if unknown:
            raise ValueError(f"unknown element symbol(s): {', '.join(unknown)}")
        coords = np.array([a["xyz"] for a in atoms], dtype=float).reshape(-1, 3)
        if not np.isfinite(coords).all():
            raise ValueError("atom coordinates must be finite numbers")
        if len(coords) > 1:
            dist = np.linalg.norm(coords[:, None, :] - coords[None, :, :], axis=-1)
            i, j = np.unravel_index(np.argmin(dist + np.eye(len(coords)) * 1e9), dist.shape)
            if dist[i, j] < MIN_SEPARATION_ANGSTROM:
                raise ValueError(
                    f"atoms {min(i, j)} and {max(i, j)} are only {dist[i, j]:.3f} Å apart "
                    f"(minimum {MIN_SEPARATION_ANGSTROM} Å); move or delete one of them"
                )
        bonds = []
        for b in d.get("bonds") or []:
            i, j, order = int(b["i"]), int(b["j"]), float(b.get("order", 1))
            if i == j or not (0 <= i < len(symbols) and 0 <= j < len(symbols)):
                raise ValueError(f"invalid bond {i}-{j}")
            if order not in BOND_TYPES:
                raise ValueError("bond order must be 1, 1.5, 2 or 3")
            bonds.append((min(i, j), max(i, j), order))
        mult = int(d.get("multiplicity", 1))
        if mult < 1:
            raise ValueError("multiplicity must be >= 1")
        return cls(symbols, coords, sorted(set(bonds)), int(d.get("charge", 0)), mult)

    def to_json(self) -> dict:
        return {
            "atoms": [{"symbol": s, "xyz": [float(x) for x in c]} for s, c in zip(self.symbols, self.coords)],
            "bonds": [{"i": i, "j": j, "order": o} for i, j, o in self.bonds],
            "charge": self.charge,
            "multiplicity": self.multiplicity,
        }

    @property
    def atoms(self) -> list[tuple[str, list[float]]]:
        return [(s, [float(x) for x in c]) for s, c in zip(self.symbols, self.coords)]

    @property
    def n_electrons(self) -> int:
        from ase.data import atomic_numbers

        return sum(atomic_numbers[s] for s in self.symbols) - self.charge

    def check_spin(self) -> None:
        """Electron count and multiplicity must have compatible parity."""
        unpaired = self.multiplicity - 1
        if unpaired > self.n_electrons or (self.n_electrons - unpaired) % 2:
            raise ValueError(
                f"multiplicity {self.multiplicity} is impossible with {self.n_electrons} electrons"
            )


# ---- RDKit perception -----------------------------------------------------


def to_rdkit(mol: Molecule, perceive_bonds: bool = False):
    """Build an RDKit molecule with 3D coordinates.

    With perceive_bonds=True (or when no bonds are given) connectivity and
    bond orders are determined from the geometry (rdDetermineBonds, xyz2mol).
    """
    from rdkit import Chem
    from rdkit.Chem import rdDetermineBonds
    from rdkit.Geometry import Point3D

    rw = Chem.RWMol()
    for s in mol.symbols:
        rw.AddAtom(Chem.Atom(s))
    conf = Chem.Conformer(len(mol.symbols))
    for k, c in enumerate(mol.coords):
        conf.SetAtomPosition(k, Point3D(*map(float, c)))
    rw.AddConformer(conf, assignId=True)
    if mol.bonds and not perceive_bonds:
        for i, j, o in mol.bonds:
            rw.AddBond(i, j, getattr(Chem.BondType, BOND_TYPES[o]))
        m = rw.GetMol()
        _assign_formal_charges(m)
        Chem.SanitizeMol(m, catchErrors=True)
        return m
    m = rw.GetMol()
    if len(mol.symbols) == 1:
        m.GetAtomWithIdx(0).SetFormalCharge(mol.charge)
        m.UpdatePropertyCache(strict=False)
        return m
    try:
        rdDetermineBonds.DetermineBonds(m, charge=mol.charge)
    except Exception as exc:  # RDKit raises several exception types here
        raise ValueError(f"bond perception from geometry failed: {exc}".split("\n")[0]) from exc
    return m


def _assign_formal_charges(m) -> None:
    """User-drawn structures carry all atoms explicitly (no implicit H).
    Tetravalent N/P gets the conventional +1 formal charge; other atoms with
    missing bonds are left neutral and RDKit reports them as radicals."""
    for atom in m.GetAtoms():
        atom.SetNoImplicit(True)
        valence = sum(b.GetBondTypeAsDouble() for b in atom.GetBonds())
        if atom.GetSymbol() in ("N", "P") and valence == 4:
            atom.SetFormalCharge(1)


def bonds_from_rdkit(m) -> list[tuple[int, int, float]]:
    return sorted(
        (min(b.GetBeginAtomIdx(), b.GetEndAtomIdx()), max(b.GetBeginAtomIdx(), b.GetEndAtomIdx()), b.GetBondTypeAsDouble())
        for b in m.GetBonds()
    )


def from_rdkit(m, charge: int | None = None, multiplicity: int | None = None) -> Molecule:
    from rdkit import Chem

    conf = m.GetConformer()
    coords = np.array([list(conf.GetAtomPosition(k)) for k in range(m.GetNumAtoms())])
    q = Chem.GetFormalCharge(m) if charge is None else charge
    radicals = sum(a.GetNumRadicalElectrons() for a in m.GetAtoms())
    mult = multiplicity if multiplicity is not None else radicals + 1
    return Molecule([a.GetSymbol() for a in m.GetAtoms()], coords, bonds_from_rdkit(m), q, mult)


def from_smiles(smiles: str, seed: int = 42) -> tuple[Molecule, dict]:
    """3D structure from SMILES: RDKit ETKDGv3 embedding + MMFF94 relaxation."""
    from rdkit import Chem
    from rdkit.Chem import AllChem

    m = Chem.MolFromSmiles(smiles)
    if m is None:
        raise ValueError(f"RDKit could not parse SMILES {smiles!r}")
    m = Chem.AddHs(m)
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    if AllChem.EmbedMolecule(m, params) != 0:
        raise ValueError("3D embedding failed")
    info = {"geometry_method": "RDKit ETKDGv3 embedding", "force_field": None}
    if AllChem.MMFFHasAllMoleculeParams(m):
        AllChem.MMFFOptimizeMolecule(m, maxIters=2000)
        info["force_field"] = "MMFF94"
        info["geometry_method"] += " + MMFF94 minimisation"
    elif AllChem.UFFHasAllMoleculeParams(m):
        AllChem.UFFOptimizeMolecule(m, maxIters=2000)
        info["force_field"] = "UFF"
        info["geometry_method"] += " + UFF minimisation"
    if _separate_fragments(m):
        info["geometry_method"] += "; disconnected fragments placed 3 Å apart (arbitrary arrangement)"
    return from_rdkit(m), info


def _separate_fragments(m, gap: float = 3.0) -> bool:
    """ETKDG embeds each disconnected fragment (e.g. the ions of a salt) around the
    origin, so they overlap. Lay them out along x with `gap` Å between their extents."""
    from rdkit import Chem
    from rdkit.Geometry import Point3D

    frags = Chem.GetMolFrags(m)
    if len(frags) < 2:
        return False
    conf = m.GetConformer()
    pos = np.array(conf.GetPositions())
    x_edge = None
    for frag in frags:
        p = pos[list(frag)]
        p = p - p.mean(axis=0)
        shift = 0.0 if x_edge is None else x_edge + gap - p[:, 0].min()
        p[:, 0] += shift
        for k, idx in enumerate(frag):
            conf.SetAtomPosition(idx, Point3D(*map(float, p[k])))
        x_edge = p[:, 0].max()
    return True


def perceive(mol: Molecule) -> dict:
    """Formula, mass, bonds and valence diagnostics."""
    from rdkit import Chem
    from rdkit.Chem import Descriptors, rdMolDescriptors

    problems = []
    try:
        m = to_rdkit(mol)
    except ValueError as exc:
        # e.g. separated ions or unusual valences: fall back to atoms only
        problems.append(str(exc))
        m = _atoms_only(mol)
    m.UpdatePropertyCache(strict=False)
    try:
        Chem.SanitizeMol(Chem.Mol(m))
    except Exception as exc:  # RDKit raises several exception types for valence errors
        problems.append(str(exc))
    radicals = sum(a.GetNumRadicalElectrons() for a in m.GetAtoms())
    smiles = None
    try:
        smiles = Chem.MolToSmiles(Chem.RemoveHs(m, sanitize=False))
    except Exception:
        pass
    formal = Chem.GetFormalCharge(m)
    if formal != mol.charge:
        problems.append(f"Lewis structure has formal charge {formal}, molecule charge is set to {mol.charge}.")
    return {
        "formula": rdMolDescriptors.CalcMolFormula(m),
        "molecular_weight_g_mol": float(Descriptors.MolWt(m)),
        "smiles": smiles,
        "n_electrons": mol.n_electrons,
        "bonds": [{"i": i, "j": j, "order": o, "length_angstrom": float(np.linalg.norm(mol.coords[i] - mol.coords[j]))} for i, j, o in bonds_from_rdkit(m)],
        "radical_electrons_lewis": radicals,
        "problems": problems,
    }


def _atoms_only(mol: Molecule):
    from rdkit import Chem

    rw = Chem.RWMol()
    for s in mol.symbols:
        a = Chem.Atom(s)
        a.SetNoImplicit(True)
        rw.AddAtom(a)
    return rw.GetMol()


# ---- measurements ---------------------------------------------------------


def distance(c: np.ndarray, i: int, j: int) -> float:
    return float(np.linalg.norm(c[i] - c[j]))


def angle(c: np.ndarray, i: int, j: int, k: int) -> float:
    u, v = c[i] - c[j], c[k] - c[j]
    cos = np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v))
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))


def dihedral(c: np.ndarray, i: int, j: int, k: int, l: int) -> float:
    b0, b1, b2 = c[i] - c[j], c[k] - c[j], c[l] - c[k]
    b1n = b1 / np.linalg.norm(b1)
    v = b0 - np.dot(b0, b1n) * b1n
    w = b2 - np.dot(b2, b1n) * b1n
    x = np.dot(v, w)
    y = np.dot(np.cross(b1n, v), w)
    return float(np.degrees(np.arctan2(y, x)))


def geometry_report(mol: Molecule, bonds: list[tuple[int, int, float]]) -> dict:
    """Bond lengths, bond angles and torsions over the bonded graph."""
    c = mol.coords
    nbrs: dict[int, list[int]] = {k: [] for k in range(len(mol.symbols))}
    for i, j, _ in bonds:
        nbrs[i].append(j)
        nbrs[j].append(i)
    angles = []
    for j, ns in nbrs.items():
        for a in range(len(ns)):
            for b in range(a + 1, len(ns)):
                angles.append({"atoms": [ns[a], j, ns[b]], "degrees": angle(c, ns[a], j, ns[b])})
    torsions = []
    for j, k, _ in bonds:
        for i in nbrs[j]:
            for l in nbrs[k]:
                if len({i, j, k, l}) == 4:
                    torsions.append({"atoms": [i, j, k, l], "degrees": dihedral(c, i, j, k, l)})
    return {
        "bond_lengths": [{"atoms": [i, j], "angstrom": distance(c, i, j)} for i, j, _ in bonds],
        "angles": angles,
        "torsions": torsions,
    }


EXAMPLES = {
    "H2": "[H][H]",
    "water": "O",
    "ammonia": "N",
    "methane": "C",
    "carbon dioxide": "O=C=O",
    "ethylene": "C=C",
    "acetylene": "C#C",
    "formaldehyde": "C=O",
    "benzene": "c1ccccc1",
    "ethanol": "CCO",
    "hydroxide ion": "[OH-]",
    "ammonium ion": "[NH4+]",
    "methyl radical": "[CH3]",
    "nitric oxide (radical)": "[N]=O",
}
