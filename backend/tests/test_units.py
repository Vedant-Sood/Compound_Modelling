import pytest

from chemmodel.units import BOHR_PM, HARTREE_EV, convert_length, nuclear_rms_radius_fm


def test_codata_constants():
    assert BOHR_PM == pytest.approx(52.917721, abs=1e-5)
    assert HARTREE_EV == pytest.approx(27.211386, abs=1e-5)


def test_length_conversions():
    assert convert_length(1, "Å", "pm") == pytest.approx(100)
    assert convert_length(1, "nm", "Å") == pytest.approx(10)
    assert convert_length(1, "pm", "fm") == pytest.approx(1000)
    assert convert_length(1, "µm", "nm") == pytest.approx(1000)


def test_nuclear_radius_scale():
    # Pb-208 measured RMS charge radius is 5.50 fm (Angeli & Marinova 2013).
    assert nuclear_rms_radius_fm(208) == pytest.approx(5.50, rel=0.03)
