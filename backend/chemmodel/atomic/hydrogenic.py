"""Analytic one-electron (hydrogen-like) atomic orbitals.

The solutions are exact for the non-relativistic Coulomb problem of one
electron bound to a point nucleus of charge Z (H, He+, Li2+, ...). The
finite nuclear mass is included through the reduced mass, which rescales
lengths (a_mu = a0 * m_e / mu) and energies (E_n * mu / m_e). Fine
structure, the Lamb shift, hyperfine structure and finite nuclear size are
not included.

Conventions: atomic units (bohr, hartree) internally; spherical harmonics
from scipy.special.sph_harm_y with the Condon-Shortley phase; real orbitals
are the standard tesseral combinations, so l=1, m=+1 is p_x and m=-1 is p_y.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import factorial, sqrt

import numpy as np
from scipy.special import eval_genlaguerre, sph_harm_y

from chemmodel.units import BOHR_PM, ELECTRON_MASS_U, RYDBERG_EV

L_LETTERS = "spdfghik"

REAL_LABELS = {
    (0, 0): "s",
    (1, -1): "p_y",
    (1, 0): "p_z",
    (1, 1): "p_x",
    (2, -2): "d_xy",
    (2, -1): "d_yz",
    (2, 0): "d_z2",
    (2, 1): "d_xz",
    (2, 2): "d_x2-y2",
    (3, -3): "f_y(3x2-y2)",
    (3, -2): "f_xyz",
    (3, -1): "f_yz2",
    (3, 0): "f_z3",
    (3, 1): "f_xz2",
    (3, 2): "f_z(x2-y2)",
    (3, 3): "f_x(x2-3y2)",
}


def validate_quantum_numbers(n: int, l: int, m: int) -> None:
    if n < 1:
        raise ValueError("n must be >= 1")
    if not 0 <= l < n:
        raise ValueError("l must satisfy 0 <= l < n")
    if abs(m) > l:
        raise ValueError("m must satisfy |m| <= l")


def orbital_label(n: int, l: int, m: int, basis: str = "real") -> str:
    letter = L_LETTERS[l] if l < len(L_LETTERS) else f"l={l}"
    if basis == "real" and (l, m) in REAL_LABELS:
        return f"{n}{REAL_LABELS[(l, m)]}"
    return f"{n}{letter} (m={m})"


@dataclass(frozen=True)
class HydrogenicSystem:
    """One electron around a nucleus of charge Z.

    nuclear_mass_u=None means an infinitely heavy nucleus (a = a0 exactly).
    """

    Z: int
    nuclear_mass_u: float | None = None

    @property
    def reduced_mass_ratio(self) -> float:
        """mu / m_e."""
        if self.nuclear_mass_u is None:
            return 1.0
        return self.nuclear_mass_u / (self.nuclear_mass_u + ELECTRON_MASS_U)

    @property
    def a_bohr(self) -> float:
        """Reduced-mass Bohr radius in units of a0."""
        return 1.0 / self.reduced_mass_ratio

    # ---- radial part --------------------------------------------------
    def radial(self, n: int, l: int, r_bohr):
        """Normalised radial function R_nl(r), r in bohr, R in bohr^-3/2."""
        validate_quantum_numbers(n, l, 0)
        r = np.asarray(r_bohr, dtype=float)
        k = 2.0 * self.Z / (n * self.a_bohr)
        rho = k * r
        norm = sqrt(k**3 * factorial(n - l - 1) / (2.0 * n * factorial(n + l)))
        return norm * np.exp(-rho / 2.0) * rho**l * eval_genlaguerre(n - l - 1, 2 * l + 1, rho)

    def radial_distribution(self, n: int, l: int, r_bohr):
        """P(r) = r^2 R_nl^2: probability per unit radius (bohr^-1)."""
        r = np.asarray(r_bohr, dtype=float)
        return r**2 * self.radial(n, l, r) ** 2

    def mean_radius_bohr(self, n: int, l: int) -> float:
        """Analytic <r> = a/(2Z) [3n^2 - l(l+1)]."""
        return self.a_bohr / (2.0 * self.Z) * (3 * n * n - l * (l + 1))

    def radius_enclosing(self, n: int, l: int, fraction: float = 0.999) -> float:
        """Radius (bohr) of the sphere containing `fraction` of the probability."""
        r_max = self.a_bohr * (6.0 * n * n + 20.0) / self.Z
        r = np.linspace(0.0, r_max, 20001)
        p = self.radial_distribution(n, l, r)
        cdf = np.concatenate([[0.0], np.cumsum(0.5 * (p[1:] + p[:-1]) * np.diff(r))])
        return float(np.interp(fraction, cdf / cdf[-1], r))

    def radial_node_radii_bohr(self, n: int, l: int) -> list[float]:
        """Radii of the n-l-1 radial nodes (roots of the Laguerre polynomial)."""
        from scipy.special import roots_genlaguerre

        count = n - l - 1
        if count == 0:
            return []
        roots, _ = roots_genlaguerre(count, 2 * l + 1)
        k = 2.0 * self.Z / (n * self.a_bohr)
        return sorted(float(x / k) for x in roots)

    # ---- energies -----------------------------------------------------
    def energy_eV(self, n: int) -> float:
        """Non-relativistic bound-state energy E_n = -(mu/m_e) Z^2 Ry / n^2."""
        return -self.reduced_mass_ratio * self.Z**2 * RYDBERG_EV / n**2

    def transition_wavelength_nm(self, n_upper: int, n_lower: int) -> float:
        from scipy.constants import c, e, h

        de = (self.energy_eV(n_upper) - self.energy_eV(n_lower)) * e
        return h * c / de * 1e9

    # ---- full wavefunction --------------------------------------------
    def psi(self, n: int, l: int, m: int, x, y, z, basis: str = "real"):
        """psi_nlm at Cartesian points in bohr.

        basis="real" returns a real array (tesseral harmonics);
        basis="complex" returns the complex eigenfunction with e^{i m phi}.
        """
        validate_quantum_numbers(n, l, m)
        x, y, z = (np.asarray(a, dtype=float) for a in (x, y, z))
        r = np.sqrt(x * x + y * y + z * z)
        theta = np.arccos(np.divide(z, r, out=np.ones_like(r), where=r > 0))
        phi = np.arctan2(y, x)
        radial = self.radial(n, l, r)
        if basis == "complex":
            return radial * sph_harm_y(l, m, theta, phi)
        if basis != "real":
            raise ValueError("basis must be 'real' or 'complex'")
        return radial * real_spherical_harmonic(l, m, theta, phi)


def real_spherical_harmonic(l: int, m: int, theta, phi):
    """Real (tesseral) spherical harmonics, orthonormal on the unit sphere."""
    if m == 0:
        return np.real(sph_harm_y(l, 0, theta, phi))
    y = sph_harm_y(l, abs(m), theta, phi)
    sign = -1.0 if abs(m) % 2 else 1.0
    if m > 0:
        return sqrt(2.0) * sign * np.real(y)
    return sqrt(2.0) * sign * np.imag(y)


def orbital_grid(
    system: HydrogenicSystem,
    n: int,
    l: int,
    m: int,
    points: int = 64,
    basis: str = "real",
    coverage: float = 0.999,
):
    """Evaluate psi on a cubic grid centred on the nucleus.

    The half-width is the radius enclosing `coverage` of the radial
    probability, so the cube always contains at least that fraction.
    Returns (half_width_bohr, axis_bohr, psi[ix, iy, iz]).
    """
    half = system.radius_enclosing(n, l, coverage)
    axis = np.linspace(-half, half, points)
    gx, gy, gz = np.meshgrid(axis, axis, axis, indexing="ij")
    return half, axis, system.psi(n, l, m, gx, gy, gz, basis=basis)


def enclosed_probability_threshold(density, voxel_volume: float, fraction: float) -> float:
    """Density value rho_t such that the region rho > rho_t holds `fraction`
    of the probability contained in the grid.

    This is how "90 % isosurfaces" are defined: the surface encloses the
    stated share of the electron, rather than using an arbitrary cut-off.
    """
    flat = np.sort(np.asarray(density, dtype=float).ravel())[::-1]
    cum = np.cumsum(flat) * voxel_volume
    target = fraction * cum[-1]
    idx = int(np.searchsorted(cum, target))
    return float(flat[min(idx, flat.size - 1)])


def to_pm(x_bohr):
    return np.asarray(x_bohr) * BOHR_PM
