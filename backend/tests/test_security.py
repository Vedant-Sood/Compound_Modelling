"""Hardening against hostile input: requests from other sites, crafted job ids,
oversized or pathological structures that would exhaust CPU or memory."""

import time

import pytest
from fastapi.testclient import TestClient

from chemmodel.api.main import app
from chemmodel.jobs import manager as M

client = TestClient(app)
NACL = {"cell": [[5.64, 0, 0], [0, 5.64, 0], [0, 0, 5.64]], "species": ["Na", "Cl"],
        "frac_coords": [[0, 0, 0], [0.5, 0.5, 0.5]]}


def test_foreign_host_header_is_rejected():
    # DNS rebinding: a page on evil.example re-resolved to 127.0.0.1 still sends its own Host
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert TestClient(app, base_url="http://127.0.0.1:8000").get("/api/health").status_code == 200
    assert TestClient(app, base_url="http://localhost:8000").get("/api/health").status_code == 200


def test_security_headers_and_cors():
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    pre = client.options("/api/jobs/scf", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in pre.headers


@pytest.mark.parametrize("bad", ["..", "...", "abc", "0123456789abcdef0123456g", "%2e%2e"])
def test_malformed_job_ids_are_not_paths(bad):
    assert client.get(f"/api/jobs/{bad}").status_code == 404
    assert client.delete(f"/api/jobs/{bad}").status_code == 404
    with pytest.raises(KeyError):
        M.job_dir("../etc")


def test_running_job_limit(monkeypatch):
    monkeypatch.setattr(M, "MAX_RUNNING_JOBS", 0)
    body = {"atoms": [["H", [0, 0, 0]]], "spin": 1, "basis": "sto-3g", "conv_tol": 1e-6, "grid_points": 16}
    r = client.post("/api/jobs/scf", json={**body, "max_cycle": 77})  # unique params: not cached
    assert r.status_code == 429


@pytest.mark.parametrize("patch", [
    {"atoms": [["H", [0, 0, 0]]] * 501},
    {"max_cycle": 10**9},
    {"conv_tol": 10.0},
    {"charge": -10**6},
    {"xc": "x" * 1000},
])
def test_scf_request_bounds(patch):
    body = {"atoms": [["H", [0, 0, 0]], ["H", [0, 0, 0.74]]], **patch}
    assert client.post("/api/jobs/scf", json=body).status_code == 422


def test_non_finite_coordinates_rejected():
    raw = '{"atoms": [["H", [NaN, 0, 0]], ["H", [0, 0, 0.74]]]}'
    r = client.post("/api/jobs/scf", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_smiles_limits():
    assert client.post("/api/molecule/from-smiles", json={"smiles": "C" * 5000}).status_code == 422
    r = client.post("/api/molecule/from-smiles", json={"smiles": "C" * 200})  # 602 atoms with H
    assert r.status_code == 422 and "limit" in r.json()["detail"]


def test_hydrogenic_fraction_parsing():
    assert client.get("/api/hydrogenic/orbital?points=16&fractions=abc").status_code == 422
    many = ",".join(["0.5"] * 11)
    assert client.get(f"/api/hydrogenic/orbital?points=16&fractions={many}").status_code == 422


def test_huge_repeats_do_not_overflow():
    # 2**32 * 2**32 overflowed numpy int64 to 0 and slipped past the 20 000-atom check
    for ep in ("display", "supercell"):
        r = client.post(f"/api/crystal/{ep}", json={"structure": NACL, "repeats": [2**32, 2**32, 1]})
        assert r.status_code == 422, ep


@pytest.mark.parametrize("cell", [
    [[1000, 0, 0], [1000, 0.001, 0], [0, 0, 1]],  # volume 1 Å^3 but nearly flat: hung the neighbour search
    [[0.01, 0, 0], [0, 10, 0], [0, 0, 10]],
])
def test_flat_cells_rejected_quickly(cell):
    t0 = time.time()
    r = client.post("/api/crystal/analyse", json={"structure": {"cell": cell, "species": ["H"], "frac_coords": [[0, 0, 0]]}})
    assert r.status_code == 422 and time.time() - t0 < 5


def test_overdense_structure_rejected():
    s = {"cell": [[3, 0, 0], [0, 3, 0], [0, 0, 3]], "species": ["H"] * 2000, "frac_coords": [[k / 2000, 0.3, 0.7] for k in range(2000)]}
    assert client.post("/api/crystal/analyse", json={"structure": s}).status_code == 422


def test_structure_shape_validation():
    bad = {**NACL, "cell": [[5.64, 0, 0], [0, 5.64, 0]]}
    assert client.post("/api/crystal/analyse", json={"structure": bad}).status_code == 422
    big_basis = {"cellpar": [10, 10, 10, 90, 90, 90], "species": ["H"] * 101, "frac_coords": [[0, 0, 0]] * 101, "spacegroup": 225}
    assert client.post("/api/crystal/build", json=big_basis).status_code == 422
