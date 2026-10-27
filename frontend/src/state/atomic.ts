// Atomic Explorer state with undo/redo history and autosave.

export type OrbitalModelKind = "hydrogenic-exact" | "hydrogenic-slater" | "scf";
export type ScfView = "density" | "spin_density" | "orbital" | "esp";

export interface AtomicState {
  symbol: string;
  charge: number;
  massNumber: number | null;
  model: OrbitalModelKind;
  n: number;
  l: number;
  m: number;
  basis: "real" | "complex";
  quantity: "density" | "amplitude";
  points: number;
  mode: "volume" | "isosurface";
  enclosedFraction: number;
  opacity: number;
  logScale: boolean;
  logDecades: number;
  clipEnabled: boolean;
  clipAxis: 0 | 1 | 2;
  clipOffsetPm: number;
  clipFlip: boolean;
  showAxes: boolean;
  orthographic: boolean;
  scfMethod: "HF" | "DFT";
  scfXc: string;
  scfBasis: string;
  scfSpin: number | null;
  scfView: ScfView;
  scfOrbital: { spin: string; index: number } | null;
  espSurfaceDensity: number;
  compare: string | null;
}

export const initialAtomicState: AtomicState = {
  symbol: "H",
  charge: 0,
  massNumber: null,
  model: "hydrogenic-exact",
  n: 1,
  l: 0,
  m: 0,
  basis: "real",
  quantity: "density",
  points: 72,
  mode: "volume",
  enclosedFraction: 0.9,
  opacity: 1,
  logScale: false,
  logDecades: 4,
  clipEnabled: false,
  clipAxis: 1,
  clipOffsetPm: 0,
  clipFlip: false,
  showAxes: true,
  orthographic: false,
  scfMethod: "HF",
  scfXc: "PBE0",
  scfBasis: "def2-svp",
  scfSpin: null,
  scfView: "density",
  scfOrbital: null,
  espSurfaceDensity: 0.001,
  compare: null,
};

export interface History {
  past: AtomicState[];
  present: AtomicState;
  future: AtomicState[];
}

export type Action =
  | { type: "set"; patch: Partial<AtomicState>; transient?: boolean }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; state: AtomicState };

/** Keep the quantum numbers consistent: 1 <= n, 0 <= l < n, |m| <= l. */
export function normaliseQuantumNumbers(s: AtomicState): AtomicState {
  const n = Math.max(1, Math.min(8, Math.round(s.n)));
  const l = Math.max(0, Math.min(n - 1, Math.round(s.l)));
  const m = Math.max(-l, Math.min(l, Math.round(s.m)));
  return { ...s, n, l, m };
}

export function historyReducer(h: History, a: Action): History {
  switch (a.type) {
    case "set": {
      const next = normaliseQuantumNumbers({ ...h.present, ...a.patch });
      if (a.transient) return { ...h, present: next };
      return { past: [...h.past.slice(-99), h.present], present: next, future: [] };
    }
    case "undo":
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case "redo":
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    case "load":
      return { past: [...h.past, h.present], present: normaliseQuantumNumbers({ ...initialAtomicState, ...a.state }), future: [] };
  }
}

const KEY = "chemmodel.atomic.v1";

export function loadAutosave(): AtomicState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normaliseQuantumNumbers({ ...initialAtomicState, ...JSON.parse(raw) });
  } catch {
    /* storage unavailable */
  }
  return initialAtomicState;
}

export function autosave(s: AtomicState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
