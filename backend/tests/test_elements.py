"""Atomic data, configurations and charge accounting."""

import pytest

from chemmodel.atomic import elements as E


def test_dataset_complete_and_ordered():
    els = E.all_elements()
    assert [e["Z"] for e in els] == list(range(1, 119))
    assert E.get_element("fe")["Z"] == 26 and E.get_element(79)["symbol"] == "Au"


@pytest.mark.parametrize(
    "sym,charge,expected",
    [
        ("H", 0, "1s1"),
        ("C", 0, "[He] 2s2 2p2"),
        ("Cr", 0, "[Ar] 3d5 4s1"),  # tabulated exception to Madelung
        ("Cu", 0, "[Ar] 3d10 4s1"),
        ("Fe", 2, "[Ar] 3d6"),
        ("Fe", 3, "[Ar] 3d5"),
        ("Na", 1, "[Ne]"),
        ("Cl", -1, "[Ar]"),
        ("Mn", 2, "[Ar] 3d5"),  # derived by rule: 4s removed before 3d
    ],
)
def test_configurations(sym, charge, expected):
    shells, _ = E.ion_configuration(sym, charge)
    assert E.format_configuration(shells) == expected


@pytest.mark.parametrize("sym", ["H", "O", "Fe", "Ag", "U"])
@pytest.mark.parametrize("charge", [-1, 0, 1, 2])
def test_charge_accounting(sym, charge):
    el = E.get_element(sym)
    if charge > el["Z"]:
        return
    shells, _ = E.ion_configuration(sym, charge)
    assert sum(s.electrons for s in shells) == el["Z"] - charge
    assert all(0 < s.electrons <= s.capacity for s in shells)


def test_madelung_matches_neutral_tabulated_for_light_elements():
    for z in range(1, 24):  # first exception is Cr (Z=24)
        el = E.get_element(z)
        tab = E.parse_configuration(el["configurations"]["0"])
        assert E.madelung_configuration(z) == tab


@pytest.mark.parametrize(
    "sym,expected", [("H", 1), ("C", 4), ("N", 5), ("Ne", 8), ("Na", 1), ("Fe", 8), ("Ga", 3), ("Pb", 4), ("Cu", 11)]
)
def test_valence_electrons(sym, expected):
    el = E.get_element(sym)
    shells, _ = E.ion_configuration(sym, 0)
    assert E.valence_electrons(shells, el["Z"], el["block"]) == expected


@pytest.mark.parametrize(
    "sym,n,l,zeff",
    [("N", 2, 1, 3.90), ("Zn", 4, 0, 4.35), ("Zn", 3, 2, 8.85), ("O", 1, 0, 7.70), ("K", 4, 0, 2.20)],
)
def test_slater_rules_textbook_values(sym, n, l, zeff):
    el = E.get_element(sym)
    shells, _ = E.ion_configuration(sym, 0)
    assert E.slater_zeff(el["Z"], shells, n, l) == pytest.approx(zeff, abs=1e-9)


def test_isotopes_have_physical_masses():
    for sym in ["H", "C", "Fe", "U"]:
        for iso in E.get_element(sym)["isotopes"]:
            assert abs(iso["mass_u"] - iso["mass_number"]) < 0.5
    natural = sum(i["abundance_percent"] or 0 for i in E.get_element("C")["isotopes"])
    assert natural == pytest.approx(100, abs=0.01)
