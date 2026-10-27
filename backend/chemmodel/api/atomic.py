"""Atomic Explorer endpoints: element properties and hydrogen-like orbitals."""

from __future__ import annotations

from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from chemmodel.atomic import elements as E
from chemmodel.atomic.hydrogenic import (
    HydrogenicSystem,
    enclosed_probability_threshold,
    orbital_grid,
    orbital_label,
    validate_quantum_numbers,
)
from chemmodel.encoding import encode_volume
from chemmodel.units import BOHR_PM, ELECTRON_MASS_U, nuclear_radius_fm

router = APIRouter(prefix="/api", tags=["atomic"])


def prop(value, unit=None, source=None, method=None, conditions=None, notes=None) -> dict:
    """A property value with provenance. value=None means unavailable."""
    return {
        "value": value,
        "unit": unit,
        "available": value is not None and value != [],
        "source": source,
        "method": method,
        "conditions": conditions,
        "notes": notes,
    }


def _element_or_404(symbol: str) -> dict:
    try:
        return E.get_element(symbol)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


def _default_isotope(el: dict) -> dict | None:
    isos = el["isotopes"]
    natural = [i for i in isos if i["abundance_percent"]]
    if natural:
        return max(natural, key=lambda i: i["abundance_percent"])
    return None


def _isotope(el: dict, mass_number: int | None) -> dict | None:
    if mass_number is None:
        return _default_isotope(el)
    for iso in el["isotopes"]:
        if iso["mass_number"] == mass_number:
            return iso
    raise HTTPException(404, f"{el['symbol']}-{mass_number} is not in the isotope table")


def nuclear_mass_u(el: dict, iso: dict | None) -> float | None:
    """Bare-nucleus mass: isotope atomic mass minus Z electron masses.
    Electron binding energies (< 0.001 u even for heavy atoms) are neglected."""
    if iso is None or iso["mass_u"] is None:
        return None
    return iso["mass_u"] - el["Z"] * ELECTRON_MASS_U


def unpaired_electrons(shells: list[E.Subshell]) -> int:
    """Hund's first rule applied to each open subshell."""
    return sum(min(s.electrons, s.capacity - s.electrons) for s in shells)


@router.get("/elements")
def list_elements():
    return {"elements": [E.element_summary(e) for e in E.all_elements()], "sources": E.sources()}


@router.get("/elements/{symbol}")
def element_detail(symbol: str, charge: int = 0, mass_number: int | None = None):
    el = _element_or_404(symbol)
    z = el["Z"]
    if charge > z:
        raise HTTPException(422, f"charge +{charge} exceeds Z={z}")
    if charge < -3:
        raise HTTPException(422, "anions beyond -3 are not supported")
    iso = _isotope(el, mass_number)
    shells, cfg_prov = E.ion_configuration(el["symbol"], charge)
    pmg = "pymatgen"
    ies = el["ionization_energies_eV"]

    shannon = [r for r in el["shannon_radii"] if r["charge"] == charge] if charge else []
    occupations = [
        {
            "subshell": s.label,
            "n": s.n,
            "l": s.l,
            "electrons": s.electrons,
            "capacity": s.capacity,
            "slater_zeff": round(E.slater_zeff(z, shells, s.n, s.l), 4),
        }
        for s in sorted(shells, key=lambda s: (s.n, s.l))
    ]
    return {
        "summary": E.element_summary(el),
        "charge": charge,
        "isotope": iso,
        "isotopes": el["isotopes"],
        "particles": {
            "protons": z,
            "neutrons": None if iso is None else iso["mass_number"] - z,
            "electrons": z - charge,
        },
        "configuration": {
            "text": E.format_configuration(shells) if shells else "(no electrons)",
            "full": E.format_configuration(shells, condensed=False) if shells else "",
            **cfg_prov,
        },
        "occupations": occupations,
        "unpaired_electrons_hund": unpaired_electrons(shells),
        "properties": {
            "atomic_mass": prop(el["atomic_mass_u"], "u", pmg, "standard atomic weight"),
            "isotope_mass": prop(iso and iso["mass_u"], "u", "mendeleev", "isotope atomic mass"),
            "valence_electrons": prop(
                E.valence_electrons(shells, z, el["block"]) if shells else 0,
                None,
                None,
                "counted from configuration",
                notes="Electrons outside the neutral atom's noble-gas core; filled d10/f14 excluded for p-block.",
            ),
            "ground_level": prop(el["ground_level"] if charge == 0 else None, None, pmg, "term symbol 2S+1 L J"),
            "ionization_energies": prop(ies or None, "eV", pmg, "experimental (tabulated)", notes="Successive IE1, IE2, ... of the neutral atom."),
            "next_ionization_energy": prop(
                ies[charge] if 0 <= charge < len(ies) else None, "eV", pmg,
                f"IE{charge + 1} (removes one electron from this species)",
            ),
            "electron_affinity": prop(el["electron_affinity_eV"], "eV", pmg, "tabulated", notes="Of the neutral atom."),
            "electronegativity_pauling": prop(el["electronegativity_pauling"], None, pmg, "Pauling scale"),
            "atomic_radius_empirical": prop(_pm(el["atomic_radius_empirical_angstrom"]), "pm", pmg, "empirical (Slater 1964)"),
            "atomic_radius_calculated": prop(_pm(el["atomic_radius_calculated_angstrom"]), "pm", pmg, "calculated (Clementi et al. 1967)"),
            "van_der_waals_radius": prop(_pm(el["van_der_waals_radius_angstrom"]), "pm", pmg, "tabulated"),
            "metallic_radius": prop(_pm(el["metallic_radius_angstrom"]), "pm", pmg, "tabulated"),
            "ionic_radii_shannon": prop(
                [
                    {**r, "ionic_radius_pm": _pm(r["ionic_radius_angstrom"]), "crystal_radius_pm": _pm(r["crystal_radius_angstrom"])}
                    for r in shannon
                ]
                or None,
                "pm",
                pmg,
                "Shannon (1976) effective ionic radii",
                conditions="depends on coordination number and spin state",
            ),
            "oxidation_states": prop(el["oxidation_states"] or None, None, pmg, "known oxidation states"),
            "common_oxidation_states": prop(el["common_oxidation_states"] or None, None, pmg, "common oxidation states"),
            "nuclear_radius_estimate": prop(
                None if iso is None else round(nuclear_radius_fm(iso["mass_number"]), 3),
                "fm",
                None,
                "equivalent uniform-sphere radius R = r0 A^(1/3), r0 = 1.2 fm",
                notes="Liquid-drop estimate, not a measured charge radius; the RMS charge radius is about 0.77 R.",
            ),
        },
        "superheavy_note": (
            "Few or no measurements exist for Z > 103; tabulated values for this element "
            "may be theoretical predictions in the source dataset."
            if z > 103
            else None
        ),
        "sources": E.sources(),
    }


def _pm(angstrom):
    return None if angstrom is None else round(angstrom * 100.0, 3)


@router.get("/atoms/{symbol}/orbital-models")
def orbital_models(symbol: str, charge: int = 0):
    """Which orbital models are scientifically appropriate for this species."""
    el = _element_or_404(symbol)
    z, n_el = el["Z"], el["Z"] - charge
    shells, _ = E.ion_configuration(el["symbol"], charge)
    models = []
    if n_el == 1:
        models.append(
            {
                "model": "hydrogenic-exact",
                "description": "Exact analytic one-electron solution (non-relativistic, point nucleus).",
                "Z": z,
            }
        )
    elif n_el > 1:
        models.append(
            {
                "model": "hydrogenic-slater",
                "description": "Hydrogen-like orbital shape with a Slater-screened effective charge. "
                "A qualitative approximation for one subshell, not a many-electron calculation.",
                "subshells": [
                    {"subshell": s.label, "n": s.n, "l": s.l, "zeff": round(E.slater_zeff(z, shells, s.n, s.l), 4)}
                    for s in shells
                ],
            }
        )
    if n_el >= 1:
        models.append(
            {
                "model": "scf",
                "description": "Hartree-Fock or DFT calculation with PySCF: genuine many-electron density and orbitals.",
            }
        )
    return {"symbol": el["symbol"], "charge": charge, "electrons": n_el, "models": models}


def _system(Z: float, mass_number: int | None, symbol: str | None) -> HydrogenicSystem:
    mass = None
    if symbol is not None:
        el = _element_or_404(symbol)
        mass = nuclear_mass_u(el, _isotope(el, mass_number))
    return HydrogenicSystem(Z=Z, nuclear_mass_u=mass)


@router.get("/hydrogenic/orbital")
def hydrogenic_orbital(
    n: int = Query(1, ge=1, le=8),
    l: int = Query(0, ge=0, le=7),
    m: int = 0,
    Z: float = Query(1.0, gt=0, le=118),
    symbol: str | None = None,
    mass_number: int | None = None,
    basis: Literal["real", "complex"] = "real",
    points: int = Query(64, ge=16, le=128),
    fractions: str = "0.5,0.9,0.95,0.99",
):
    """Wavefunction psi_nlm on a cube that encloses 99.9 % of the probability.

    For basis=complex the response holds |psi|^2 and the phase arg(psi).
    `symbol`/`mass_number` select the nucleus for the reduced-mass correction.
    """
    try:
        validate_quantum_numbers(n, l, m)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    sys = _system(Z, mass_number, symbol)
    half, axis, psi = orbital_grid(sys, n, l, m, points=points, basis=basis)
    dv = (axis[1] - axis[0]) ** 3
    density = np.abs(psi) ** 2
    grid_prob = float(density.sum() * dv)
    thresholds = {}
    for f in (float(x) for x in fractions.split(",") if x):
        if 0 < f < 1:
            thresholds[f"{f:g}"] = enclosed_probability_threshold(density, dv, f)
    volumes = {"density": encode_volume(density)}
    if basis == "real":
        volumes["amplitude"] = encode_volume(psi)
    else:
        volumes["phase"] = encode_volume(np.angle(psi))
    return {
        "label": orbital_label(n, l, m, basis),
        "quantum_numbers": {"n": n, "l": l, "m": m},
        "basis": basis,
        "Z": Z,
        "reduced_mass_ratio": sys.reduced_mass_ratio,
        "length_scale_pm": sys.a_bohr * BOHR_PM,
        "grid": {
            "half_width_pm": half * BOHR_PM,
            "spacing_pm": (axis[1] - axis[0]) * BOHR_PM,
            "shape": [points] * 3,
            "origin_pm": [-half * BOHR_PM] * 3,
            "coverage": 0.999,
            "riemann_probability": grid_prob,
        },
        "units": {"density": "bohr^-3", "amplitude": "bohr^-3/2", "phase": "rad"},
        "max_density": float(density.max()),
        "max_abs_amplitude": float(np.abs(psi).max()),
        "thresholds_by_enclosed_fraction": thresholds,
        "nodes": {
            "radial": n - l - 1,
            "angular": l,
            "radial_node_radii_pm": [r * BOHR_PM for r in sys.radial_node_radii_bohr(n, l)],
        },
        "mean_radius_pm": sys.mean_radius_bohr(n, l) * BOHR_PM,
        "energy_eV": sys.energy_eV(n),
        "volumes": volumes,
        "method": "analytic hydrogen-like eigenfunction",
    }


@router.get("/hydrogenic/radial")
def hydrogenic_radial(
    n: int = Query(1, ge=1, le=8),
    l: int = Query(0, ge=0, le=7),
    Z: float = Query(1.0, gt=0, le=118),
    symbol: str | None = None,
    mass_number: int | None = None,
    samples: int = Query(400, ge=50, le=4000),
):
    try:
        validate_quantum_numbers(n, l, 0)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    sys = _system(Z, mass_number, symbol)
    r_max = sys.radius_enclosing(n, l, 0.9999)
    r = np.linspace(0, r_max, samples)
    return {
        "r_pm": (r * BOHR_PM).tolist(),
        "R": sys.radial(n, l, r).tolist(),
        "P_per_pm": (sys.radial_distribution(n, l, r) / BOHR_PM).tolist(),
        "units": {"r": "pm", "R": "bohr^-3/2", "P": "pm^-1"},
        "mean_radius_pm": sys.mean_radius_bohr(n, l) * BOHR_PM,
        "most_probable_radius_pm": float(r[np.argmax(sys.radial_distribution(n, l, r))] * BOHR_PM),
    }


@router.get("/hydrogenic/levels")
def hydrogenic_levels(
    Z: float = Query(1.0, gt=0, le=118),
    n_max: int = Query(6, ge=1, le=20),
    symbol: str | None = None,
    mass_number: int | None = None,
):
    sys = _system(Z, mass_number, symbol)
    levels = [
        {"n": n, "energy_eV": sys.energy_eV(n), "degeneracy": 2 * n * n} for n in range(1, n_max + 1)
    ]
    lines = []
    for lower, series in ((1, "Lyman"), (2, "Balmer"), (3, "Paschen")):
        for upper in range(lower + 1, n_max + 1):
            lines.append({"series": series, "upper": upper, "lower": lower, "wavelength_nm": sys.transition_wavelength_nm(upper, lower)})
    return {
        "Z": Z,
        "reduced_mass_ratio": sys.reduced_mass_ratio,
        "ionization_energy_eV": -sys.energy_eV(1),
        "levels": levels,
        "lines": lines,
        "method": "Bohr/Schrödinger levels with reduced-mass correction; wavelengths in vacuum",
        "limitations": "No fine structure, Lamb shift or hyperfine splitting (relative errors ~1e-5 for H).",
    }
