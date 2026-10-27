"""Element data access, electron configurations and electron counting.

Tabulated values come from the shipped dataset (see
scripts/build_element_data.py); each response carries the source of every
value. Values computed here by rule (ion configurations not present in the
dataset, Slater screening) are labelled as such.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from chemmodel.atomic.hydrogenic import L_LETTERS

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "elements.json"

NOBLE_CORES = {"He": 2, "Ne": 10, "Ar": 18, "Kr": 36, "Xe": 54, "Rn": 86}

# Madelung (n + l, then n) filling order up to 7p.
MADELUNG = sorted(
    [(n, l) for n in range(1, 8) for l in range(0, min(n, 4))],
    key=lambda nl: (nl[0] + nl[1], nl[0]),
)

SUBSHELL_RE = re.compile(r"^(\d+)([spdfg])(\d+)$")


@dataclass(frozen=True)
class Subshell:
    n: int
    l: int
    electrons: int

    @property
    def label(self) -> str:
        return f"{self.n}{L_LETTERS[self.l]}"

    @property
    def capacity(self) -> int:
        return 2 * (2 * self.l + 1)


@lru_cache(maxsize=1)
def _dataset() -> dict:
    return json.loads(DATA_PATH.read_text())


def sources() -> dict:
    return _dataset()["sources"]


@lru_cache(maxsize=1)
def _by_symbol() -> dict[str, dict]:
    return {e["symbol"]: e for e in _dataset()["elements"]}


def all_elements() -> list[dict]:
    return _dataset()["elements"]


def get_element(symbol_or_z: str | int) -> dict:
    if isinstance(symbol_or_z, int) or str(symbol_or_z).isdigit():
        z = int(symbol_or_z)
        if not 1 <= z <= 118:
            raise KeyError(f"no element with Z={z}")
        return all_elements()[z - 1]
    sym = str(symbol_or_z).strip().capitalize()
    if sym not in _by_symbol():
        raise KeyError(f"unknown element symbol {symbol_or_z!r}")
    return _by_symbol()[sym]


# ---- configurations -----------------------------------------------------


def parse_configuration(text: str) -> list[Subshell]:
    """Expand e.g. '[Ar].3d6.4s2' into explicit subshells."""
    shells: list[Subshell] = []
    for part in text.replace(" ", ".").split("."):
        if not part:
            continue
        if part.startswith("["):
            core = part.strip("[]")
            core_cfg = get_element(core)["configurations"]["0"]
            shells.extend(parse_configuration(core_cfg))
            continue
        match = SUBSHELL_RE.match(part)
        if not match:
            raise ValueError(f"cannot parse subshell {part!r}")
        n, letter, occ = match.groups()
        shells.append(Subshell(int(n), L_LETTERS.index(letter), int(occ)))
    return _merge(shells)


def _merge(shells: list[Subshell]) -> list[Subshell]:
    occ: dict[tuple[int, int], int] = {}
    for s in shells:
        occ[(s.n, s.l)] = occ.get((s.n, s.l), 0) + s.electrons
    return [Subshell(n, l, e) for (n, l), e in sorted(occ.items()) if e > 0]


def madelung_configuration(electrons: int) -> list[Subshell]:
    """Idealised aufbau filling; known exceptions (Cr, Cu, ...) are not reproduced."""
    shells, left = [], electrons
    for n, l in MADELUNG:
        if left <= 0:
            break
        take = min(left, 2 * (2 * l + 1))
        shells.append(Subshell(n, l, take))
        left -= take
    if left > 0:
        raise ValueError("too many electrons for the supported subshells")
    return _merge(shells)


def format_configuration(shells: list[Subshell], condensed: bool = True) -> str:
    shells = sorted(shells, key=lambda s: (s.n, s.l))
    if condensed:
        for core, ncore in sorted(NOBLE_CORES.items(), key=lambda kv: -kv[1]):
            core_shells = parse_configuration(get_element(core)["configurations"]["0"])
            core_set = {(s.n, s.l): s.electrons for s in core_shells}
            if all(
                any(s.n == n and s.l == l and s.electrons == e for s in shells)
                for (n, l), e in core_set.items()
            ) and sum(s.electrons for s in shells) >= ncore:
                rest = [s for s in shells if (s.n, s.l) not in core_set]
                return (f"[{core}] " + " ".join(f"{s.label}{s.electrons}" for s in rest)).strip()
    return " ".join(f"{s.label}{s.electrons}" for s in shells)


def ion_configuration(symbol: str, charge: int) -> tuple[list[Subshell], dict]:
    """Ground-state configuration of the ion with the given charge.

    Returns (subshells, provenance). Tabulated configurations are used when
    the dataset has them; otherwise cations remove electrons from the
    highest-n subshell first (highest l within that n), and anions add
    electrons in Madelung order. That rule reproduces most transition-metal
    cations (4s before 3d) but is not guaranteed for every ion.
    """
    el = get_element(symbol)
    z = el["Z"]
    electrons = z - charge
    if electrons < 0:
        raise ValueError(f"charge +{charge} exceeds Z={z}")
    if electrons == 0:
        return [], {"method": "bare nucleus", "source": None}
    configs = el.get("configurations") or {}
    if str(charge) in configs:
        return parse_configuration(configs[str(charge)]), {
            "method": "tabulated",
            "source": "pymatgen",
        }
    if "0" in configs:
        shells = parse_configuration(configs["0"])
        base = {"method": "neutral tabulated configuration, then removal/addition rule", "source": "pymatgen"}
    else:
        shells = madelung_configuration(z)
        base = {"method": "Madelung-rule prediction (no tabulated configuration)", "source": None}
    occ = {(s.n, s.l): s.electrons for s in shells}
    if charge > 0:
        for _ in range(charge):
            key = max((k for k, v in occ.items() if v > 0), key=lambda k: (k[0], k[1]))
            occ[key] -= 1
    elif charge < 0:
        for _ in range(-charge):
            for n, l in MADELUNG:
                if occ.get((n, l), 0) < 2 * (2 * l + 1):
                    occ[(n, l)] = occ.get((n, l), 0) + 1
                    break
    result = [Subshell(n, l, e) for (n, l), e in sorted(occ.items()) if e > 0]
    return result, base


def noble_gas_core(Z: int) -> str | None:
    """Largest noble-gas core with fewer electrons than Z."""
    cores = [c for c, n in NOBLE_CORES.items() if n < Z]
    return max(cores, key=NOBLE_CORES.get) if cores else None


def valence_electrons(shells: list[Subshell], Z: int, block: str | None) -> int:
    """Electrons outside the neutral atom's noble-gas core, excluding the
    filled (n-1)d10 and (n-2)f14 subshells of p-block elements. This is the
    conventional chemistry definition; ions keep the neutral atom's core, so
    Fe2+ ([Ar] 3d6) has 6 and Na+ has 0."""
    core = noble_gas_core(Z)
    core_occ: dict[tuple[int, int], int] = {}
    if core:
        core_occ = {(c.n, c.l): c.electrons for c in parse_configuration(get_element(core)["configurations"]["0"])}
    n_max = max((s.n for s in shells), default=0)
    count = 0
    for s in shells:
        extra = s.electrons - core_occ.get((s.n, s.l), 0)
        if extra <= 0:
            continue
        if block == "p" and s.electrons == s.capacity and s.l >= 2 and s.n < n_max:
            continue
        count += extra
    return count


# ---- Slater screening -----------------------------------------------------


def _slater_group(s: Subshell) -> tuple[int, int]:
    # (n, 0) groups s and p together; d and f are their own groups.
    return (s.n, 0 if s.l <= 1 else s.l)


def slater_zeff(Z: int, shells: list[Subshell], n: int, l: int) -> float:
    """Effective nuclear charge for an electron in subshell (n, l) using
    Slater's 1930 rules. An empirical screening estimate, not an SCF result."""
    target = (n, 0 if l <= 1 else l)
    sigma = 0.0
    for s in shells:
        g = _slater_group(s)
        e = s.electrons
        if g == target:
            if (s.n, s.l) == (n, l):
                e -= 1  # exclude the electron itself
            sigma += e * (0.30 if (n, l) == (1, 0) else 0.35)
        elif target[1] == 0:  # s/p electron
            if s.n == n - 1:
                sigma += 0.85 * e
            elif s.n < n - 1:
                sigma += 1.00 * e
        else:  # d/f electron: everything in groups to its left screens fully
            if g[0] < target[0] or (g[0] == target[0] and g[1] < target[1]):
                sigma += 1.00 * e
    return Z - sigma


def element_summary(el: dict) -> dict:
    return {
        "Z": el["Z"],
        "symbol": el["symbol"],
        "name": el["name"],
        "period": el["period"],
        "group": el["group"],
        "block": el["block"],
        "series": el["series"],
        "atomic_mass_u": el["atomic_mass_u"],
    }
