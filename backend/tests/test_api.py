import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from chemmodel.api.main import app
from chemmodel.encoding import decode_array

client = TestClient(app)


def test_health_lists_engines():
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["engines"]["pyscf"]


def test_element_detail_provenance_and_unavailable_values():
    r = client.get("/api/elements/Fe?charge=3&mass_number=56").json()
    assert r["particles"] == {"protons": 26, "neutrons": 30, "electrons": 23}
    assert r["configuration"]["text"] == "[Ar] 3d5"
    assert r["unpaired_electrons_hund"] == 5
    p = r["properties"]["electronegativity_pauling"]
    assert p["available"] and p["source"] == "pymatgen"
    og = client.get("/api/elements/Og").json()
    assert og["properties"]["electronegativity_pauling"]["available"] is False
    assert og["superheavy_note"]
    assert og["configuration"]["method"].startswith("Madelung")


def test_bad_inputs_rejected():
    assert client.get("/api/elements/Xx").status_code == 404
    assert client.get("/api/hydrogenic/orbital?n=2&l=2").status_code == 422
    assert client.get("/api/elements/H?charge=2").status_code == 422


def test_orbital_volume_roundtrip():
    r = client.get("/api/hydrogenic/orbital?n=2&l=1&m=1&points=32&symbol=H").json()
    assert r["label"] == "2p_x"
    amp = decode_array(r["volumes"]["amplitude"])  # stored [z][y][x]
    assert amp.shape == (32, 32, 32)
    # positive lobe on +x
    assert amp[16, 16, 28] > 0 > amp[16, 16, 3]
    assert set(r["thresholds_by_enclosed_fraction"]) == {"0.5", "0.9", "0.95", "0.99"}


def test_orbital_models():
    r = client.get("/api/atoms/He/orbital-models?charge=1").json()
    assert r["models"][0]["model"] == "hydrogenic-exact"
    r = client.get("/api/atoms/C/orbital-models").json()
    assert r["models"][0]["model"] == "hydrogenic-slater"


def test_scf_job_end_to_end(tmp_path, monkeypatch):
    from chemmodel.jobs import manager as M

    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    body = {"atoms": [["He", [0, 0, 0]]], "basis": "cc-pvdz", "grid_points": 24}
    job = client.post("/api/jobs/scf", json=body).json()
    for _ in range(240):
        status = client.get(f"/api/jobs/{job['id']}").json()
        if status["state"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert status["state"] == "done", status
    res = status["result"]
    assert res["energy_Eh"] == pytest.approx(-2.8552, abs=1e-3)  # RHF/cc-pVDZ He
    rho = decode_array(res["volumes"]["density"])
    assert rho.shape == (24, 24, 24) and np.all(rho >= -1e-12)
    orb = client.get(f"/api/jobs/{job['id']}/orbital?index=0").json()
    assert orb["occupation"] == 2.0
    esp = client.get(f"/api/jobs/{job['id']}/esp").json()
    assert esp["min"] > 0  # neutral closed-shell atom: ESP positive everywhere
    # identical settings return the cached result
    again = client.post("/api/jobs/scf", json=body).json()
    assert again["id"] == job["id"]
