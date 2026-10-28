"""Regression tests for bugs found in the October 2026 audit."""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from chemmodel.api.main import app
from chemmodel.jobs import manager as M
from chemmodel.molecular import structure as S

client = TestClient(app)


def test_orbital_models_rejects_impossible_charge():
    assert client.get("/api/atoms/H/orbital-models?charge=5").status_code == 422  # was a 500
    assert client.get("/api/atoms/H/orbital-models?charge=-200").status_code == 422


def test_unknown_element_message_is_clean():
    r = client.get("/api/elements/Xx")
    assert r.status_code == 404 and not r.json()["detail"].startswith('"')


@pytest.mark.parametrize("smiles", ["[Fe+2]", "[Na+].[Cl-]", "[O-2]"])
def test_ionic_smiles_do_not_crash(smiles):
    r = client.post("/api/molecule/from-smiles", json={"smiles": smiles})
    assert r.status_code == 200, r.text


def test_salt_fragments_are_not_stacked():
    mol = client.post("/api/molecule/from-smiles", json={"smiles": "[Na+].[Cl-]"}).json()["molecule"]
    a, b = (np.array(x["xyz"]) for x in mol["atoms"])
    assert np.linalg.norm(a - b) >= 2.5  # ETKDG put both ions at the origin


def test_overlapping_and_unknown_atoms_rejected():
    two = {"atoms": [{"symbol": "O", "xyz": [0, 0, 0]}, {"symbol": "O", "xyz": [0, 0, 0.01]}]}
    assert client.post("/api/molecule/forcefield-optimize", json=two).status_code == 422  # was a 500
    assert client.post("/api/molecule/analyze", json={"atoms": [{"symbol": "Q", "xyz": [0, 0, 0]}]}).status_code == 422
    with pytest.raises(ValueError):
        S.Molecule.from_json({"atoms": [{"symbol": "H", "xyz": [0, 0, float("nan")]}]})


def test_unbonded_ion_pair_can_be_analysed():
    nacl = {"atoms": [{"symbol": "Na", "xyz": [0, 0, 0]}, {"symbol": "Cl", "xyz": [0, 0, 6]}]}
    r = client.post("/api/molecule/analyze", json=nacl)
    assert r.status_code == 200 and r.json()["analysis"]["formula"] == "ClNa"
    assert client.post("/api/molecule/forcefield-optimize", json=nacl).status_code == 422


def test_scan_inputs_validated():
    h2 = {"atoms": [{"symbol": "H", "xyz": [0, 0, 0]}, {"symbol": "H", "xyz": [0, 0, 0.74]}]}
    for bad in (dict(i=0, j=0, r_min=0.5, r_max=1), dict(i=0, j=7, r_min=0.5, r_max=1), dict(i=0, j=1, r_min=1.5, r_max=0.5)):
        assert client.post("/api/molecule/jobs/scan", json={"molecule": h2, **bad}).status_code == 422


def test_scf_preflight():
    bad = [
        {"atoms": [["H", [0, 0, 0]]], "charge": 1},  # no electrons
        {"atoms": [["H", [0, 0, 0]]], "spin": 0},  # parity
        {"atoms": [["Og", [0, 0, 0]]], "basis": "cc-pvdz"},  # no basis for Og
        {"atoms": [["Xx", [0, 0, 0]]]},
    ]
    for b in bad:
        assert client.post("/api/jobs/scf", json=b).status_code == 422, b


def test_truncated_result_is_not_cached(tmp_path, monkeypatch):
    """A worker killed mid-write must not leave a result.json that later loads as cached."""
    monkeypatch.setattr(M, "CACHE_DIR", tmp_path)
    wd = tmp_path / "x"
    wd.mkdir()

    class Q:
        def put(self, item):
            pass

    M._worker("scf", {"atoms": [["He", [0, 0, 0]]], "basis": "sto-3g", "grid_points": 16}, str(wd), Q())
    assert json.loads((wd / "result.json").read_text())["converged"]
    assert not (wd / "result.json.tmp").exists()
