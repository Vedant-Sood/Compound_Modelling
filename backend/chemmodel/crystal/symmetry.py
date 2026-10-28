"""Space-group analysis with spglib."""

from __future__ import annotations

import numpy as np

from chemmodel.crystal.structures import Structure

CRYSTAL_SYSTEMS = [
    (2, "triclinic"), (15, "monoclinic"), (74, "orthorhombic"), (142, "tetragonal"),
    (167, "trigonal"), (194, "hexagonal"), (230, "cubic"),
]


def _cell(s: Structure):
    from ase.data import atomic_numbers

    return (s.cell, s.frac, [atomic_numbers[x] for x in s.species])


def crystal_system(number: int) -> str:
    return next(name for top, name in CRYSTAL_SYSTEMS if number <= top)


def analyse(s: Structure, symprec: float = 1e-3) -> dict:
    import spglib

    ds = spglib.get_symmetry_dataset(_cell(s), symprec=symprec)
    if ds is None:
        raise ValueError(f"spglib could not determine the symmetry (symprec = {symprec} Å)")
    n = int(ds.number)
    hall = ds.international
    lattice_letter = hall[0]
    return {
        "international": hall,
        "number": n,
        "hall": ds.hall,
        "point_group": ds.pointgroup,
        "crystal_system": crystal_system(n),
        "bravais_centring": lattice_letter,
        "n_operations": len(ds.rotations),
        "wyckoff": [
            {"index": i, "species": s.species[i], "letter": w, "site_symmetry": ss, "equivalent_to": int(e)}
            for i, (w, ss, e) in enumerate(zip(ds.wyckoffs, ds.site_symmetry_symbols, ds.equivalent_atoms))
        ],
        "symprec_angstrom": symprec,
        "engine": f"spglib {spglib.__version__}",
    }


def standardise(s: Structure, to_primitive: bool, symprec: float = 1e-3) -> Structure:
    import spglib

    out = spglib.standardize_cell(_cell(s), to_primitive=to_primitive, no_idealize=False, symprec=symprec)
    if out is None:
        raise ValueError("spglib could not standardise this cell")
    from ase.data import chemical_symbols

    lattice, frac, numbers = out
    return Structure(np.array(lattice), [chemical_symbols[z] for z in numbers], np.array(frac) % 1.0, s.pbc)
