"""Balanced mode (GFN-xTB via tblite). Skipped when tblite is not installed."""

import time

import numpy as np
import pytest

pytest.importorskip("tblite.interface")

from fastapi.testclient import TestClient

from chemmodel.api.main import app
from chemmodel.molecular import structure as S
from chemmodel.molecular import xtb

client = TestClient(app)


def water(r=0.96, theta=104.5):
    t = np.radians(theta) / 2
    return S.Molecule(
        ["O", "H", "H"],
        np.array([[0, 0, 0], [r * np.sin(t), 0, r * np.cos(t)], [-r * np.sin(t), 0, r * np.cos(t)]]),
        [(0, 1, 1), (0, 2, 1)],
        0,
        1,
    )


def test_water_gfn2_singlepoint():
    res = xtb.singlepoint(water())
    # GFN2-xTB total energy of water near its minimum is about -5.07 Eh (xtb reference output)
    assert res["energy_Eh"] == pytest.approx(-5.07, abs=0.01)
    assert res["homo_lumo_gap_eV"] > 5
    q = res["atomic_charges"]
    assert sum(q) == pytest.approx(0, abs=1e-6)
    assert q[0] < 0 < q[1]
    assert 1.5 < np.linalg.norm(res["dipole_debye"]) < 3.0
    assert res["warnings"]


def test_water_gfn2_optimisation_converges():
    final, steps, converged = xtb.optimise(water(1.05, 115), "GFN2-xTB", lambda m: None)
    assert converged
    assert steps[-1]["energy_Eh"] < steps[0]["energy_Eh"]
    r = np.linalg.norm(final.coords[1] - final.coords[0])
    assert r == pytest.approx(0.96, abs=0.02)  # GFN2 r(OH) ~0.96 Å


def test_heavy_element_rejected():
    mol = S.Molecule(["U"], np.zeros((1, 3)), [], 0, 1)
    with pytest.raises(ValueError):
        xtb.singlepoint(mol)


def test_xtb_job_api(tmp_path, monkeypatch):
    from chemmodel.jobs import manager as M

    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    mol = water().to_json()
    job = client.post("/api/molecule/jobs/xtb", json={"molecule": mol, "optimise": True}).json()
    for _ in range(240):
        st = client.get(f"/api/jobs/{job['id']}").json()
        if st["state"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert st["state"] == "done", st
    res = st["result"]
    assert res["solver"] == "GFN2-xTB"
    assert res["optimisation"]["converged"]
    assert len(res["molecule"]["atoms"]) == 3
    assert client.get("/api/health").json()["engines"]["tblite"] != "missing"
