// Length units used across the viewport. Scene coordinates are picometres.

export const LENGTH_UNITS: { unit: string; pm: number }[] = [
  { unit: "fm", pm: 1e-3 },
  { unit: "pm", pm: 1 },
  { unit: "Å", pm: 100 },
  { unit: "nm", pm: 1e3 },
  { unit: "µm", pm: 1e6 },
  { unit: "mm", pm: 1e9 },
];

export const BOHR_PM = 52.917721;
export const HARTREE_EV = 27.211386;

/** Pick the unit that keeps the number between 1 and 1000 (Å preferred for 100-1000 pm). */
export function bestUnit(pm: number): { unit: string; pm: number } {
  const a = Math.abs(pm);
  if (a === 0) return LENGTH_UNITS[1];
  let best = LENGTH_UNITS[0];
  for (const u of LENGTH_UNITS) if (a >= u.pm) best = u;
  return best;
}

export function formatLength(pm: number, digits = 3): string {
  const u = bestUnit(pm);
  return `${Number((pm / u.pm).toPrecision(digits))} ${u.unit}`;
}

/** A "nice" scale-bar length (1, 2 or 5 x 10^k pm) not longer than maxPx. */
export function niceScaleBar(pmPerPx: number, maxPx = 140): { pm: number; px: number; label: string } {
  const maxPm = pmPerPx * maxPx;
  const exp = Math.floor(Math.log10(maxPm));
  let pm = 10 ** exp;
  for (const f of [5, 2, 1]) {
    if (f * 10 ** exp <= maxPm) {
      pm = f * 10 ** exp;
      break;
    }
  }
  return { pm, px: pm / pmPerPx, label: formatLength(pm, 3) };
}

/** Which physical description applies at this zoom (scene width in pm). */
export function representationLevel(viewWidthPm: number): { level: string; note: string } {
  if (viewWidthPm < 0.5)
    return {
      level: "Nuclear (fm)",
      note: "Nuclear structure is not modelled: the nucleus is a uniform sphere of estimated radius.",
    };
  if (viewWidthPm < 5e4) return { level: "Atomic / quantum", note: "" };
  return {
    level: "Beyond atomic scale",
    note: "Atomic mode models a single atom; no bulk material is represented at this scale.",
  };
}
