"""Geometry of periodic structures: supercells, neighbours, density, planes, display."""

from __future__ import annotations

import numpy as np

from chemmodel.crystal.structures import Structure

AVOGADRO = 6.02214076e23


def supercell(s: Structure, n: tuple[int, int, int]) -> Structure:
    n1, n2, n3 = (int(x) for x in n)
    if min(n1, n2, n3) < 1 or n1 * n2 * n3 * len(s.species) > 20000:
        raise ValueError("supercell repeats must be >= 1 and give at most 20 000 atoms")
    shifts = np.array([(i, j, k) for i in range(n1) for j in range(n2) for k in range(n3)], dtype=float)
    frac = ((s.frac[None, :, :] + shifts[:, None, :]) / np.array([n1, n2, n3])).reshape(-1, 3)
    cell = s.cell * np.array([[n1], [n2], [n3]])
    return Structure(cell, list(s.species) * len(shifts), frac, s.pbc)


def density_g_cm3(s: Structure) -> float:
    from ase.data import atomic_masses, atomic_numbers

    mass_g = sum(atomic_masses[atomic_numbers[x]] for x in s.species) / AVOGADRO
    vol_cm3 = abs(np.linalg.det(s.cell)) * 1e-24
    return float(mass_g / vol_cm3)


def neighbours(s: Structure, cutoff: float = 6.0) -> list[list[tuple[int, float, np.ndarray]]]:
    """For every site: (neighbour index, distance Å, lattice image offset), sorted by distance,
    under periodic boundary conditions (ase.neighborlist)."""
    from ase.neighborlist import neighbor_list

    i, j, d, S = neighbor_list("ijdS", s.to_ase(), cutoff, self_interaction=False)
    out: list[list[tuple[int, float, np.ndarray]]] = [[] for _ in s.species]
    for a, b, dist, img in zip(i, j, d, S):
        out[a].append((int(b), float(dist), img))
    for row in out:
        row.sort(key=lambda t: t[1])
    return out


def coordination(s: Structure, tolerance: float = 0.1, cutoff: float = 6.0) -> list[dict]:
    """First coordination shell of each site: neighbours within (1 + tolerance) × the
    nearest-neighbour distance of that site. Also reports the second shell distance."""
    rows = []
    for k, nb in enumerate(neighbours(s, cutoff)):
        if not nb:
            rows.append({"index": k, "species": s.species[k], "cn": 0, "nearest_angstrom": None, "neighbours": {}, "second_shell_angstrom": None})
            continue
        d0 = nb[0][1]
        shell = [t for t in nb if t[1] <= d0 * (1 + tolerance)]
        rest = [t for t in nb if t[1] > d0 * (1 + tolerance)]
        counts: dict[str, int] = {}
        for j, _, _ in shell:
            counts[s.species[j]] = counts.get(s.species[j], 0) + 1
        rows.append({
            "index": k,
            "species": s.species[k],
            "cn": len(shell),
            "nearest_angstrom": d0,
            "shell_max_angstrom": shell[-1][1],
            "neighbours": counts,
            "second_shell_angstrom": rest[0][1] if rest else None,
        })
    return rows


def bond_angles(s: Structure, index: int, tolerance: float = 0.1) -> list[float]:
    """Angles (degrees) between first-shell neighbours of one site."""
    nb = neighbours(s)[index]
    if not nb:
        return []
    d0 = nb[0][1]
    centre = s.cartesian[index]
    vecs = [s.cartesian[j] + img @ s.cell - centre for j, d, img in nb if d <= d0 * (1 + tolerance)]
    angles = []
    for a in range(len(vecs)):
        for b in range(a + 1, len(vecs)):
            c = np.dot(vecs[a], vecs[b]) / (np.linalg.norm(vecs[a]) * np.linalg.norm(vecs[b]))
            angles.append(float(np.degrees(np.arccos(np.clip(c, -1, 1)))))
    return sorted(angles)


def miller_plane(s: Structure, hkl: tuple[int, int, int]) -> dict:
    """Plane (hkl): unit normal (Cartesian), interplanar spacing d_hkl = 1/|G| with
    G = h a* + k b* + l c* (reciprocal lattice without the 2π factor)."""
    h = np.array(hkl, dtype=float)
    if not h.any():
        raise ValueError("(hkl) must not be (000)")
    recip = np.linalg.inv(s.cell).T  # rows a*, b*, c*
    g = h @ recip
    return {"hkl": [int(x) for x in hkl], "normal": (g / np.linalg.norm(g)).tolist(), "d_spacing_angstrom": float(1 / np.linalg.norm(g))}


def display_geometry(s: Structure, repeats: tuple[int, int, int] = (1, 1, 1), boundary: bool = True,
                     tolerance: float = 0.1) -> dict:
    """Atoms and bonds to draw for `repeats` unit cells.

    With boundary=True, atoms on cell faces, edges and corners are also drawn at their
    periodic images on the far side (the textbook picture of a conventional cell; e.g.
    8 corner atoms of an fcc cell). Bonds join first-shell neighbours (see coordination)
    whose both ends are drawn. `site` maps each drawn atom back to the unit-cell site."""
    n = np.array(repeats, dtype=int)
    if (n < 1).any() or n.prod() * len(s.species) > 20000:
        raise ValueError("repeats must be >= 1 and give at most 20 000 atoms")
    eps = 1e-6
    frac0 = s.frac % 1.0
    frac0[np.abs(frac0 - 1) < eps] = 0.0
    drawn_frac, site = [], []
    for k, f in enumerate(frac0):
        ranges = [range(0, n[d] + (1 if boundary and abs(f[d]) < eps else 0)) for d in range(3)]
        for i in ranges[0]:
            for j in ranges[1]:
                for l in ranges[2]:
                    drawn_frac.append(f + (i, j, l))
                    site.append(k)
    drawn_frac = np.array(drawn_frac)
    xyz = drawn_frac @ s.cell

    # first-shell bond length per unordered species pair from the coordination analysis
    coord = coordination(s, tolerance)
    shell_max = {k: row.get("shell_max_angstrom") for k, row in enumerate(coord)}
    bonds = []
    if len(xyz) > 1:
        from scipy.spatial import cKDTree

        rmax = max((v for v in shell_max.values() if v), default=0)
        tree = cKDTree(xyz)
        for a, b in tree.query_pairs(rmax + 1e-6):
            d = float(np.linalg.norm(xyz[a] - xyz[b]))
            la, lb = shell_max[site[a]], shell_max[site[b]]
            if (la and d <= la + 1e-6) or (lb and d <= lb + 1e-6):
                bonds.append({"i": int(a), "j": int(b), "order": 1, "length_angstrom": d})
    return {
        "atoms": [{"symbol": s.species[k], "xyz": p.tolist(), "site": int(k)} for k, p in zip(site, xyz)],
        "bonds": bonds,
        "cell": s.cell.tolist(),
        "repeats": n.tolist(),
        "boundary_images": boundary,
    }
