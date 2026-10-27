"""Validation of the analytic hydrogen-like orbitals (spec section 15: Hydrogen Atom)."""

import numpy as np
import pytest
from scipy.integrate import quad

from chemmodel.atomic.elements import get_element
from chemmodel.atomic.hydrogenic import (
    HydrogenicSystem,
    enclosed_probability_threshold,
    orbital_grid,
    orbital_label,
    real_spherical_harmonic,
)
from chemmodel.units import ELECTRON_MASS_U

H = HydrogenicSystem(Z=1)
NL = [(n, l) for n in range(1, 7) for l in range(n)]


@pytest.mark.parametrize("n,l", NL)
def test_radial_normalisation(n, l):
    val, _ = quad(lambda r: H.radial_distribution(n, l, r), 0, np.inf, limit=400)
    assert val == pytest.approx(1.0, abs=1e-10)


@pytest.mark.parametrize("n,l", NL)
def test_mean_radius_matches_analytic(n, l):
    val, _ = quad(lambda r: r * H.radial_distribution(n, l, r), 0, np.inf, limit=400)
    assert val == pytest.approx(H.mean_radius_bohr(n, l), rel=1e-9)


def test_1s_closed_form():
    r = np.linspace(0, 10, 50)
    psi = H.psi(1, 0, 0, r, 0 * r, 0 * r)
    np.testing.assert_allclose(psi, np.exp(-r) / np.sqrt(np.pi), rtol=1e-12)


def test_2p_closed_form():
    # psi_210 = z exp(-r/2) / (4 sqrt(2 pi))
    x, y, z = 0.3, -0.7, 1.1
    r = np.sqrt(x * x + y * y + z * z)
    expect = z * np.exp(-r / 2) / (4 * np.sqrt(2 * np.pi))
    assert H.psi(2, 1, 0, x, y, z) == pytest.approx(expect, rel=1e-12)


def _sphere_quadrature(n=48):
    xs, ws = np.polynomial.legendre.leggauss(n)
    theta = np.arccos(xs)
    phi = np.linspace(0, 2 * np.pi, 2 * n, endpoint=False)
    T, P = np.meshgrid(theta, phi, indexing="ij")
    W = np.outer(ws, np.full(phi.size, 2 * np.pi / phi.size))
    return T, P, W


def test_real_harmonics_orthonormal_up_to_f():
    T, P, W = _sphere_quadrature()
    lm = [(l, m) for l in range(4) for m in range(-l, l + 1)]
    Y = np.array([real_spherical_harmonic(l, m, T, P) for l, m in lm])
    gram = np.einsum("aij,bij,ij->ab", Y, Y, W)
    np.testing.assert_allclose(gram, np.eye(len(lm)), atol=1e-12)


@pytest.mark.parametrize(
    "l,m,point",
    [(1, 1, (1, 0, 0)), (1, -1, (0, 1, 0)), (1, 0, (0, 0, 1)), (2, 2, (1, 0, 0)), (2, -2, (1, 1, 0)), (2, 1, (1, 0, 1))],
)
def test_real_orbital_labels_point_along_their_axes(l, m, point):
    # The positive lobe of p_x lies along +x, d_xy along x=y, etc.
    n = l + 1
    assert H.psi(n, l, m, *point) > 0
    assert orbital_label(n, l, m)


def test_radial_nodes_count_and_location():
    for n, l in NL:
        radii = H.radial_node_radii_bohr(n, l)
        assert len(radii) == n - l - 1
        for r0 in radii:
            assert abs(H.radial(n, l, r0)) < 1e-10
    # 2s node at r = 2 a0
    assert H.radial_node_radii_bohr(2, 0) == [pytest.approx(2.0)]


def test_scaling_with_Z():
    he = HydrogenicSystem(Z=2)
    assert he.mean_radius_bohr(1, 0) == pytest.approx(0.75)
    assert he.energy_eV(1) == pytest.approx(4 * H.energy_eV(1))


def test_hydrogen_ionization_energy_vs_nist():
    h = get_element("H")
    proton_mass = h["isotopes"][0]["mass_u"] - ELECTRON_MASS_U
    sys = HydrogenicSystem(Z=1, nuclear_mass_u=proton_mass)
    # NIST ASD: 13.598434 eV. Residual is fine structure + QED (~1e-5 relative).
    assert -sys.energy_eV(1) == pytest.approx(h["ionization_energies_eV"][0], abs=5e-4)
    # Balmer alpha (vacuum) 656.47 nm
    assert sys.transition_wavelength_nm(3, 2) == pytest.approx(656.47, abs=0.05)


def test_helium_ion_ionization_energy_vs_nist():
    he = get_element("He")
    m = he["isotopes"][1]["mass_u"] - 2 * ELECTRON_MASS_U  # He-4
    assert he["isotopes"][1]["mass_number"] == 4
    sys = HydrogenicSystem(Z=2, nuclear_mass_u=m)
    assert -sys.energy_eV(1) == pytest.approx(he["ionization_energies_eV"][1], abs=5e-3)


def test_grid_coverage_and_enclosed_threshold():
    half, axis, psi = orbital_grid(H, 1, 0, 0, points=96)
    dv = (axis[1] - axis[0]) ** 3
    rho = psi**2
    assert rho.sum() * dv == pytest.approx(0.999, abs=0.01)
    # 90 % sphere for 1s: 1 - e^{-2r}(1 + 2r + 2r^2) = 0.9
    from scipy.optimize import brentq

    r90 = brentq(lambda r: 1 - np.exp(-2 * r) * (1 + 2 * r + 2 * r * r) - 0.9 * 0.999, 0.1, 10)
    t = enclosed_probability_threshold(rho, dv, 0.9)
    assert t == pytest.approx(np.exp(-2 * r90) / np.pi, rel=0.08)
