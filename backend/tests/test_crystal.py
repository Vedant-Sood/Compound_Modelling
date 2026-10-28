"""Crystal Explorer validation (HANDOFF.md workstream B acceptance tests)."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from chemmodel.api.main import app
from chemmodel.crystal import analysis as A
from chemmodel.crystal import defects as D
from chemmodel.crystal import symmetry as Y
from chemmodel.crystal.structures import REFERENCE_STRUCTURES, Structure, build_reference

client = TestClient(app)


def cn(s, species):
    return {r["cn"] for r in A.coordination(s) if r["species"] == species}


def test_nacl():
    s = build_reference("NaCl (rock salt)")
    assert Y.analyse(s)["number"] == 225
    assert cn(s, "Na") == {6} and cn(s, "Cl") == {6}
    a = 5.6402
    assert A.coordination(s)[0]["nearest_angstrom"] == pytest.approx(a / 2, abs=1e-6)
    assert A.density_g_cm3(s) == pytest.approx(2.165, rel=0.01)  # CRC handbook 2.17 g/cm³


def test_cu_fcc():
    s = build_reference("Cu (fcc)")
    assert Y.analyse(s)["number"] == 225
    assert cn(s, "Cu") == {12}
    assert A.coordination(s)[0]["nearest_angstrom"] == pytest.approx(3.6149 / np.sqrt(2), abs=1e-6)
    assert A.density_g_cm3(s) == pytest.approx(8.96, rel=0.01)  # CRC handbook, 20 °C
    prim = Y.standardise(s, to_primitive=True)
    assert len(prim.species) == 1


@pytest.mark.parametrize("name", ["Diamond (C)", "Si (diamond)"])
def test_diamond_lattice(name):
    s = build_reference(name)
    assert Y.analyse(s)["number"] == 227
    assert cn(s, s.species[0]) == {4}
    assert set(np.round(A.bond_angles(s, 0), 2)) == {109.47}


def test_si_density_matches_codata_lattice():
    assert A.density_g_cm3(build_reference("Si (diamond)")) == pytest.approx(2.329, abs=0.002)


def test_bcc_fe_and_hcp_graphite():
    fe = build_reference("α-Fe (bcc)")
    assert Y.analyse(fe)["number"] == 229 and cn(fe, "Fe") == {8}
    assert A.density_g_cm3(fe) == pytest.approx(7.874, rel=0.005)
    gr = build_reference("Graphite (hexagonal)")
    assert Y.analyse(gr)["number"] == 194 and cn(gr, "C") == {3}
    assert A.coordination(gr)[0]["nearest_angstrom"] == pytest.approx(1.42, abs=0.01)


def test_other_references_symmetry():
    expected = {"CsCl": 221, "CaF2 (fluorite)": 225, "ZnS (zinc blende)": 216, "Mg (hcp)": 194,
                "TiO2 (rutile)": 136, "SrTiO3 (cubic perovskite)": 221, "Al (fcc)": 225, "W (bcc)": 229}
    for name, number in expected.items():
        assert Y.analyse(build_reference(name))["number"] == number, name
    assert cn(build_reference("CsCl"), "Cs") == {8}
    f = build_reference("CaF2 (fluorite)")
    assert cn(f, "Ca") == {8} and cn(f, "F") == {4}
    assert set(REFERENCE_STRUCTURES) >= set(expected)


def test_supercell_and_vacancy():
    s = build_reference("NaCl (rock salt)")
    sc = A.supercell(s, (2, 2, 2))
    assert len(sc.species) == 8 * len(s.species)
    assert Y.analyse(sc)["number"] == 225
    v = D.vacancy(sc, 0)
    assert v.species.count("Na") == sc.species.count("Na") - 1
    assert v.species.count("Cl") == sc.species.count("Cl")
    assert Y.analyse(v)["number"] != 225  # vacancy lowers the symmetry


def test_substitution_and_interstitial():
    cu = build_reference("Cu (fcc)")
    sub = D.substitution(cu, 0, "Au")
    assert sub.species.count("Au") == 1
    with pytest.raises(ValueError):
        D.interstitial(cu, "H", [0, 0, 0])  # on top of an atom
    octa = D.interstitial(cu, "H", [0.5, 0.5, 0.5])  # octahedral site of fcc
    assert cn(octa, "H") == {6}


def test_miller_plane_spacing():
    s = build_reference("Cu (fcc)")
    a = 3.6149
    for hkl in [(1, 0, 0), (1, 1, 0), (1, 1, 1)]:
        assert A.miller_plane(s, hkl)["d_spacing_angstrom"] == pytest.approx(a / np.sqrt(sum(h * h for h in hkl)))
    hcp = build_reference("Mg (hcp)")
    assert A.miller_plane(hcp, (0, 0, 1))["d_spacing_angstrom"] == pytest.approx(5.2105)


def test_display_includes_boundary_images():
    s = build_reference("Cu (fcc)")
    d = A.display_geometry(s, (1, 1, 1), boundary=True)
    assert len(d["atoms"]) == 14  # 8 corners + 6 face centres
    assert len(A.display_geometry(s, (1, 1, 1), boundary=False)["atoms"]) == 4
    assert all(abs(b["length_angstrom"] - 3.6149 / np.sqrt(2)) < 1e-6 for b in d["bonds"])
    assert len(A.display_geometry(s, (2, 2, 2), boundary=False)["atoms"]) == 32


def test_api_roundtrip():
    r = client.post("/api/crystal/build", json={"name": "Si (diamond)"}).json()
    assert r["symmetry"]["international"] == "Fd-3m"
    st = r["structure"]
    assert client.post("/api/crystal/analyse", json={"structure": st}).json()["n_atoms"] == 8
    assert client.post("/api/crystal/standardise", json={"structure": st, "kind": "primitive"}).json()["n_atoms"] == 2
    edited = client.post("/api/crystal/build", json={"name": "Si (diamond)", "cellpar": [5.6, 5.6, 5.6, 90, 90, 90]}).json()
    assert "hypothetical" in edited["provenance"]
    assert client.post("/api/crystal/build", json={"name": "Unobtainium"}).status_code == 422
    bad = {"cell": [[0, 0, 0], [0, 1, 0], [0, 0, 1]], "species": ["H"], "frac_coords": [[0, 0, 0]]}
    assert client.post("/api/crystal/analyse", json={"structure": bad}).status_code == 422
    assert client.post("/api/crystal/plane", json={"structure": st, "hkl": [0, 0, 0]}).status_code == 422
    assert client.post("/api/crystal/defect", json={"structure": st, "kind": "vacancy"}).status_code == 422


def test_user_defined_with_spacegroup():
    r = client.post("/api/crystal/build", json={"cellpar": [3.6149] * 3 + [90] * 3, "species": ["Cu"], "frac_coords": [[0, 0, 0]], "spacegroup": 225}).json()
    assert r["n_atoms"] == 4 and r["symmetry"]["number"] == 225
