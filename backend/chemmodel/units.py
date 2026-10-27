"""Physical constants (CODATA via scipy.constants) and length-unit helpers.

All internal atomic-scale lengths are in bohr (atomic units) for quantum
calculations and in picometres for anything sent to the renderer.
"""

from __future__ import annotations

from scipy import constants as C

BOHR_M = C.physical_constants["Bohr radius"][0]
BOHR_PM = BOHR_M * 1e12
HARTREE_EV = C.physical_constants["Hartree energy in eV"][0]
RYDBERG_EV = C.physical_constants["Rydberg constant times hc in eV"][0]
ELECTRON_MASS_U = C.physical_constants["electron mass in u"][0]
ELECTRON_MASS_KG = C.m_e
ATOMIC_MASS_KG = C.physical_constants["atomic mass constant"][0]

# Length units, expressed in metres. Ordered from small to large.
LENGTH_UNITS_M = {
    "fm": 1e-15,
    "pm": 1e-12,
    "Å": 1e-10,
    "nm": 1e-9,
    "µm": 1e-6,
    "mm": 1e-3,
}


def convert_length(value: float, from_unit: str, to_unit: str) -> float:
    return value * LENGTH_UNITS_M[from_unit] / LENGTH_UNITS_M[to_unit]


def bohr_to_pm(x):
    return x * BOHR_PM


def pm_to_bohr(x):
    return x / BOHR_PM


def nuclear_radius_fm(mass_number: int, r0_fm: float = 1.2) -> float:
    """Equivalent uniform-sphere nuclear radius R = r0 A^(1/3), r0 = 1.2 fm.

    This is the liquid-drop estimate of the sharp-edged radius, not the RMS
    charge radius (which is sqrt(3/5) R). Light nuclei deviate strongly.
    """
    return r0_fm * mass_number ** (1.0 / 3.0)


def nuclear_rms_radius_fm(mass_number: int) -> float:
    """RMS charge radius implied by the uniform-sphere estimate."""
    return (3.0 / 5.0) ** 0.5 * nuclear_radius_fm(mass_number)
