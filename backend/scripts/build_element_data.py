"""Build the offline element dataset shipped with Chemical Modelling.

The output (``chemmodel/data/elements.json``) is generated from two
established, MIT-licensed open-source datasets so the application can run
offline and every value carries its provenance:

* pymatgen-core ``periodic_table.json`` (atomic masses, configurations,
  ionization energies, electron affinities, radii, oxidation states)
* mendeleev (isotope table, series classification)

Run from ``backend/``::

    python scripts/build_element_data.py

Values that are missing from the sources are written as ``null`` and shown
as "unavailable" in the application; nothing is filled in by hand.
"""

from __future__ import annotations

import json
import math
from importlib.metadata import version
from pathlib import Path

from mendeleev import element as mendeleev_element
from pymatgen.core import Element

OUT = Path(__file__).resolve().parents[1] / "chemmodel" / "data" / "elements.json"

PMG = f"pymatgen-core {version('pymatgen-core')} periodic_table.json"
MDL = f"mendeleev {version('mendeleev')}"


def _clean(value):
    """Convert pymatgen's FloatWithUnit / strings to plain JSON numbers."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return f


def _configs(data: dict) -> dict[str, str] | None:
    es = data.get("Electronic structure")
    if es is None:
        return None
    if isinstance(es, str):
        return {"0": es}
    return {k: v for k, v in es.items() if v}


def _shannon(data: dict) -> list[dict]:
    """Flatten Shannon (1976) radii: charge -> coordination -> spin -> radii (Å)."""
    rows = []
    for charge, by_cn in (data.get("Shannon radii") or {}).items():
        if not charge.lstrip("-").isdigit():
            continue  # the source has one entry without a charge (Eu); skip it
        for cn, by_spin in by_cn.items():
            for spin, radii in by_spin.items():
                rows.append(
                    {
                        "charge": int(charge),
                        "coordination": cn,
                        "spin": spin or None,
                        "ionic_radius_angstrom": radii.get("ionic_radius"),
                        "crystal_radius_angstrom": radii.get("crystal_radius"),
                    }
                )
    rows.sort(key=lambda r: (r["charge"], r["coordination"]))
    return rows


def _isotopes(m) -> list[dict]:
    rows = []
    for iso in m.isotopes:
        rows.append(
            {
                "mass_number": iso.mass_number,
                "mass_u": iso.mass,
                "mass_uncertainty_u": iso.mass_uncertainty,
                "abundance_percent": iso.abundance,
                "is_stable": bool(iso.is_stable) if iso.is_stable is not None else None,
                "half_life": iso.half_life,
                "half_life_unit": iso.half_life_unit,
                "spin": iso.spin,
            }
        )
    rows.sort(key=lambda r: r["mass_number"])
    return rows


def build() -> dict:
    elements = []
    for z in range(1, 119):
        el = Element.from_Z(z)
        d = el.data
        m = mendeleev_element(z)
        ies = [_clean(v) for v in (d.get("Ionization energies") or [])]
        elements.append(
            {
                "Z": z,
                "symbol": el.symbol,
                "name": d.get("Name"),
                "period": el.row,
                "group": el.group,
                "block": el.block,
                "series": m.series,
                "atomic_mass_u": _clean(d.get("Atomic mass")),
                "configurations": _configs(d),
                "ground_level": d.get("Ground level"),
                "ionization_energies_eV": [v for v in ies if v is not None],
                "electron_affinity_eV": _clean(d.get("Electron affinity")),
                "electronegativity_pauling": _clean(d.get("X")),
                "atomic_radius_empirical_angstrom": _clean(d.get("Atomic radius")),
                "atomic_radius_calculated_angstrom": _clean(d.get("Atomic radius calculated")),
                "van_der_waals_radius_angstrom": _clean(d.get("Van der waals radius")),
                "metallic_radius_angstrom": _clean(d.get("Metallic radius")),
                "shannon_radii": _shannon(d),
                "oxidation_states": d.get("Oxidation states") or [],
                "common_oxidation_states": d.get("Common oxidation states") or [],
                "isotopes": _isotopes(m),
            }
        )
    return {
        "sources": {
            "pymatgen": {
                "name": PMG,
                "license": "MIT",
                "url": "https://github.com/materialsproject/pymatgen",
                "fields": [
                    "atomic_mass_u",
                    "configurations",
                    "ground_level",
                    "ionization_energies_eV",
                    "electron_affinity_eV",
                    "electronegativity_pauling",
                    "atomic_radius_empirical_angstrom",
                    "atomic_radius_calculated_angstrom",
                    "van_der_waals_radius_angstrom",
                    "metallic_radius_angstrom",
                    "shannon_radii",
                    "oxidation_states",
                    "common_oxidation_states",
                ],
            },
            "mendeleev": {
                "name": MDL,
                "license": "MIT",
                "url": "https://github.com/lmmentel/mendeleev",
                "fields": ["isotopes", "series"],
            },
        },
        "elements": elements,
    }


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=1))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} kB)")
