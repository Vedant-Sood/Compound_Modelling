"""Point defects. Results are hypothetical structures (not relaxed, not from experiment)."""

from __future__ import annotations

import numpy as np

from chemmodel.crystal.structures import Structure


def vacancy(s: Structure, index: int) -> Structure:
    _check(s, index)
    keep = [k for k in range(len(s.species)) if k != index]
    if not keep:
        raise ValueError("cannot remove the only atom")
    return Structure(s.cell.copy(), [s.species[k] for k in keep], s.frac[keep].copy(), s.pbc)


def substitution(s: Structure, index: int, species: str) -> Structure:
    _check(s, index)
    out = Structure.from_json({**s.to_json(), "species": [species if k == index else x for k, x in enumerate(s.species)]})
    return out


def interstitial(s: Structure, species: str, frac: list[float], min_distance: float = 0.5) -> Structure:
    f = np.array(frac, dtype=float).reshape(3) % 1.0
    out = Structure.from_json({**s.to_json(), "species": s.species + [species], "frac_coords": np.vstack([s.frac, f]).tolist()})
    from chemmodel.crystal.analysis import neighbours

    nb = neighbours(out, cutoff=max(min_distance, 0.1))[-1]
    if nb:
        raise ValueError(f"interstitial is only {nb[0][1]:.2f} Å from atom {nb[0][0]} (minimum {min_distance} Å)")
    return out


def _check(s: Structure, index: int) -> None:
    if not 0 <= index < len(s.species):
        raise ValueError(f"site index must be between 0 and {len(s.species) - 1}")
