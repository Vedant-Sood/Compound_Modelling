"""Electronic-structure validation against reference values (spec section 15)."""

import numpy as np
import pytest

from chemmodel.quantum import scf as Q

WATER = [("O", (0.0, 0.0, 0.1173)), ("H", (0.0, 0.7572, -0.4692)), ("H", (0.0, -0.7572, -0.4692))]


def test_hydrogen_atom_uhf_approaches_exact():
    _, _, s = Q.run_scf([("H", (0, 0, 0))], Q.SCFSettings(basis="cc-pvtz"))
    # exact non-relativistic energy -0.5 Eh; cc-pVTZ basis error ~ 1e-4 Eh
    assert s["converged"] and s["spin_2S"] == 1
    assert s["energy_Eh"] == pytest.approx(-0.5, abs=5e-4)


def test_h2_hf_bond_length_and_curve():
    rs = np.linspace(0.66, 0.84, 10)
    es = [Q.run_scf([("H", (0, 0, 0)), ("H", (0, 0, r))], Q.SCFSettings(basis="cc-pvdz"))[2]["energy_Eh"] for r in rs]
    fit = np.polyfit(rs, es, 4)
    fine = np.linspace(rs[0], rs[-1], 2001)
    r_eq = fine[np.argmin(np.polyval(fit, fine))]
    # HF/cc-pVDZ equilibrium 0.746 Å (NIST CCCBDB); experiment 0.741 Å
    assert r_eq == pytest.approx(0.746, abs=0.005)
    assert min(es) == pytest.approx(-1.1287, abs=1e-3)


def test_water_rhf_energy_dipole_and_density():
    mol, mf, s = Q.run_scf(WATER, Q.SCFSettings(basis="cc-pvdz"))
    assert s["converged"]
    # Reference RHF/cc-pVDZ near the experimental geometry: -76.0268 Eh
    assert s["energy_Eh"] == pytest.approx(-76.0268, abs=2e-3)
    assert np.linalg.norm(s["dipole_debye"]) == pytest.approx(2.04, abs=0.15)  # HF overestimates 1.85 D
    assert sum(s["mulliken_charges"]) == pytest.approx(0.0, abs=1e-8)
    grid = Q.grid_for(mol, 72, 5.0)
    rho = Q.density_on_grid(mol, Q.total_dm(mf), grid)
    # coarse grid: oxygen cusp is under-resolved, but most electrons are captured
    assert Q.electron_count_on_grid(rho, grid) == pytest.approx(10, rel=0.08)
    assert rho.min() >= -1e-12


def test_esp_neutral_atom_is_positive_and_decays():
    mol, mf, _ = Q.run_scf([("Ne", (0, 0, 0))], Q.SCFSettings(basis="cc-pvdz"))
    pts = np.array([[0, 0, r] for r in (0.5, 1.0, 2.0, 6.0)])
    v = Q.esp_on_points(mol, Q.total_dm(mf), pts)
    assert np.all(v > 0) and np.all(np.diff(v) < 0)
    assert v[-1] < 1e-3


def test_open_shell_dft():
    _, _, s = Q.run_scf([("O", (0, 0, 0))], Q.SCFSettings(method="DFT", xc="PBE", spin=2))
    assert s["converged"] and s["spin_2S"] == 2
    occ_alpha = sum(o["occupation"] for o in s["orbitals"] if o["spin"] == "alpha")
    occ_beta = sum(o["occupation"] for o in s["orbitals"] if o["spin"] == "beta")
    assert (occ_alpha, occ_beta) == (5, 3)


def test_heavy_element_uses_ecp_and_warns():
    _, _, s = Q.run_scf([("Xe", (0, 0, 0))], Q.SCFSettings(basis="def2-svp"))
    assert s["ecp"] and any("effective core potential" in w for w in s["warnings"])
