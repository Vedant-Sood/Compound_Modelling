"""Molecular modelling validation (spec section 15: hydrogen molecule, water)."""

import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from chemmodel.api.main import app
from chemmodel.molecular import structure as S
from chemmodel.molecular.optimize import bond_scan, force_field_optimise, quantum_optimise
from chemmodel.quantum import scf as Q

client = TestClient(app)


def test_smiles_water_geometry_and_perception():
    mol, info = S.from_smiles("O")
    assert info["force_field"] == "MMFF94"
    a = S.perceive(mol)
    assert a["formula"] == "H2O" and a["molecular_weight_g_mol"] == pytest.approx(18.015, abs=1e-3)
    assert len(a["bonds"]) == 2 and not a["problems"]


def test_bond_perception_from_xyz_only():
    mol, _ = S.from_smiles("C=C")
    bare = S.Molecule(mol.symbols, mol.coords, [], 0, 1)
    rd = S.to_rdkit(bare, perceive_bonds=True)
    orders = sorted(o for *_, o in S.bonds_from_rdkit(rd))
    assert orders == [1, 1, 1, 1, 2]


def test_radical_and_ion_accounting():
    radical, _ = S.from_smiles("[CH3]")
    assert radical.multiplicity == 2 and radical.n_electrons == 9
    ion, _ = S.from_smiles("[NH4+]")
    assert ion.charge == 1 and ion.n_electrons == 10
    with pytest.raises(ValueError):
        S.Molecule(ion.symbols, ion.coords, ion.bonds, 1, 2).check_spin()


def test_measurements():
    c = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1.0]])
    assert S.distance(c, 0, 1) == pytest.approx(1)
    assert S.angle(c, 0, 1, 2) == pytest.approx(90)
    assert abs(S.dihedral(c, 0, 1, 2, 3)) == pytest.approx(90)


def test_mmff_relaxes_distorted_methane():
    mol, _ = S.from_smiles("C")
    mol.coords[1] *= 1.3
    res = force_field_optimise(mol)
    assert res["converged"] and res["final_energy_kcal_mol"] < res["initial_energy_kcal_mol"]
    c = np.array([a["xyz"] for a in res["molecule"]["atoms"]])
    assert S.angle(c, 1, 0, 2) == pytest.approx(109.47, abs=0.5)


def test_water_hf_631gs_optimised_geometry():
    mol, _ = S.from_smiles("O")
    out, steps, _, converged = quantum_optimise(mol, Q.SCFSettings(basis="6-31g*"), lambda m: None)
    assert converged
    # HF/6-31G* reference (NIST CCCBDB): r(OH) = 0.947 Å, HOH = 105.5°
    assert S.distance(out.coords, 0, 1) == pytest.approx(0.947, abs=0.002)
    assert S.angle(out.coords, 1, 0, 2) == pytest.approx(105.5, abs=0.3)
    energies = [s["energy_Eh"] for s in steps]
    assert energies[-1] <= energies[0]


def test_h2_bond_scan_curve():
    mol = S.Molecule(["H", "H"], np.array([[0, 0, 0], [0, 0, 0.74]]), [(0, 1, 1)], 0, 1)
    pts = bond_scan(mol, 0, 1, list(np.linspace(0.5, 1.2, 8)), Q.SCFSettings(basis="cc-pvdz"), lambda m: None)
    e = [p["energy_Eh"] for p in pts]
    k = int(np.argmin(e))
    assert 0 < k < len(e) - 1  # bound minimum inside the scan
    assert pts[k]["r_angstrom"] == pytest.approx(0.75, abs=0.06)


def test_api_analyze_and_geomopt_job(tmp_path, monkeypatch):
    from chemmodel.jobs import manager as M

    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    mol = client.post("/api/molecule/from-smiles", json={"smiles": "[H][H]"}).json()["molecule"]
    an = client.post("/api/molecule/analyze", json=mol).json()
    assert an["analysis"]["formula"] == "H2"
    body = {"molecule": mol, "basis": "cc-pvdz", "grid_points": 24}
    job = client.post("/api/molecule/jobs/geomopt", json=body).json()
    for _ in range(240):
        st = client.get(f"/api/jobs/{job['id']}").json()
        if st["state"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert st["state"] == "done", st
    res = st["result"]
    xyz = np.array([a["xyz"] for a in res["molecule"]["atoms"]])
    assert np.linalg.norm(xyz[0] - xyz[1]) == pytest.approx(0.746, abs=0.003)
    assert res["optimisation"]["converged"]
    orb = client.get(f"/api/jobs/{job['id']}/orbital?index=0").json()  # sigma_g bonding MO
    assert orb["occupation"] == 2.0


def test_invalid_molecules_rejected():
    assert client.post("/api/molecule/analyze", json={"atoms": []}).status_code == 422
    bad = {"atoms": [{"symbol": "H", "xyz": [0, 0, 0]}], "multiplicity": 1}
    assert client.post("/api/molecule/jobs/scf", json={"molecule": bad}).status_code == 422
