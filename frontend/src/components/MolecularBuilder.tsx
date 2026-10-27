// MODE B - Molecular Builder: build molecules in 3D, optimise them with a
// force field or PySCF, and inspect orbitals, densities and potentials.

import * as THREE from "three";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, decodeArray, type Job, type SCFResult } from "../api/client";
import {
  molApi,
  type Analysis,
  type DisplayData,
  type GeomOptResult,
  type MoleculeJSON,
  type ScanResult,
} from "../api/molecular";
import { StructureLayer } from "../render/StructureLayer";
import { VolumeRenderer, type VolumeField, type ViewInfo } from "../render/VolumeRenderer";
import { enclosedThreshold, minMax } from "../science/threshold";
import { formatLength, niceScaleBar, HARTREE_EV } from "../science/units";
import { Console, dataURLtoBlob } from "./common";
import { EnergyDiagram, type Level } from "./EnergyDiagram";
import { LineChart, download } from "./LineChart";
import { Splitter } from "./Splitter";
import { useLog } from "./useLog";

type Tool = "select" | "add" | "delete" | "bond";
type View = "none" | "density" | "spin_density" | "orbital" | "esp";

const EMPTY: MoleculeJSON = { atoms: [], bonds: [], charge: 0, multiplicity: 1 };
const KJ_PER_HARTREE = 2625.4996;
const QUICK_ELEMENTS = ["H", "C", "N", "O", "F", "S", "P", "Cl", "Br", "B", "Si", "Li", "Na"];

interface Hist {
  past: MoleculeJSON[];
  present: MoleculeJSON;
  future: MoleculeJSON[];
}
type HAction = { type: "set"; mol: MoleculeJSON } | { type: "undo" } | { type: "redo" };
function histReducer(h: Hist, a: HAction): Hist {
  if (a.type === "set") return { past: [...h.past.slice(-99), h.present], present: a.mol, future: [] };
  if (a.type === "undo" && h.past.length)
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
  if (a.type === "redo" && h.future.length)
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  return h;
}

interface Snapshot {
  name: string;
  molecule: MoleculeJSON;
  energyEh: number | null;
  methodKey: string;
  formula: string;
}

const STORE = "chemmodel.molecular.v1";

function loadStored(): MoleculeJSON {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return EMPTY;
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function angleDeg(a: number[], b: number[], c: number[]) {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
function dihedralDeg(p0: number[], p1: number[], p2: number[], p3: number[]) {
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const b0 = sub(p0, p1);
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const n = Math.hypot(...b1);
  const b1n = b1.map((x) => x / n);
  const v = sub(b0, b1n.map((x) => x * dot(b0, b1n)));
  const w = sub(b2, b1n.map((x) => x * dot(b2, b1n)));
  return (Math.atan2(dot(cross(b1n, v), w), dot(v, w)) * 180) / Math.PI;
}
export const geometry = { dist, angleDeg, dihedralDeg };

export function toXYZ(m: MoleculeJSON, comment: string): string {
  return [String(m.atoms.length), comment, ...m.atoms.map((a) => `${a.symbol} ${a.xyz.map((x) => x.toFixed(6)).join(" ")}`)].join("\n") + "\n";
}

export function MolecularBuilder() {
  const [hist, dispatch] = useReducer(histReducer, undefined, () => ({ past: [], present: loadStored(), future: [] }));
  const mol = hist.present;
  const setMol = useCallback((m: MoleculeJSON) => dispatch({ type: "set", mol: m }), []);
  const { log, entries, clear } = useLog();

  const [display, setDisplay] = useState<DisplayData | null>(null);
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [element, setElement] = useState("C");
  const [selected, setSelected] = useState<number[]>([]);
  const [smiles, setSmiles] = useState("");
  const [method, setMethod] = useState<"HF" | "DFT">("HF");
  const [xc, setXc] = useState("B3LYP");
  const [basis, setBasis] = useState("6-31g*");
  const [job, setJob] = useState<Job<SCFResult | GeomOptResult | ScanResult> | null>(null);
  const [jobMolKey, setJobMolKey] = useState("");
  const [view, setView] = useState<View>("none");
  const [orbitalSel, setOrbitalSel] = useState<{ spin: string; index: number } | null>(null);
  const [field, setField] = useState<VolumeField | null>(null);
  const [fieldTitle, setFieldTitle] = useState("");
  const [mode, setMode] = useState<"volume" | "isosurface">("isosurface");
  const [fraction, setFraction] = useState(0.9);
  const [opacity, setOpacity] = useState(0.55);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [scanRange, setScanRange] = useState({ min: 0.5, max: 2.0, points: 15 });
  const [vi, setVi] = useState<ViewInfo | null>(null);
  const [tab, setTab] = useState("console");
  const [lastFF, setLastFF] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VolumeRenderer | null>(null);
  const layerRef = useRef<StructureLayer | null>(null);
  const molKey = useMemo(() => JSON.stringify(mol), [mol]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, molKey);
    } catch {
      /* storage unavailable */
    }
  }, [molKey]);

  useEffect(() => {
    molApi.displayData().then(setDisplay).catch((e) => log(`display data: ${e.message}`, "error"));
    molApi.examples().then((r) => setExamples(r.examples)).catch(() => undefined);
  }, [log]);

  // renderer + structure layer
  useEffect(() => {
    const r = new VolumeRenderer(viewportRef.current!);
    const layer = new StructureLayer();
    r.solids.add(layer.group);
    let last = 0;
    r.onView = (v) => {
      const now = performance.now();
      if (now - last > 60) {
        last = now;
        setVi(v);
      }
    };
    rendererRef.current = r;
    layerRef.current = layer;
    return () => r.dispose();
  }, []);

  // redraw structure
  useEffect(() => {
    if (!display || !layerRef.current) return;
    layerRef.current.set(mol.atoms, mol.bonds, { radiusScale: 0.35, covalent: display.covalent_radius_angstrom, colour: display.colour }, selected);
    rendererRef.current?.requestRender();
  }, [mol, display, selected]);

  // chemical perception after every edit
  useEffect(() => {
    if (!mol.atoms.length) return setAnalysis(null);
    const t = setTimeout(() => {
      molApi.analyze(mol).then((r) => setAnalysis(r.analysis)).catch((e) => setAnalysis({ formula: "?", molecular_weight_g_mol: 0, smiles: null, n_electrons: 0, radical_electrons_lewis: 0, problems: [e.message] }));
    }, 250);
    return () => clearTimeout(t);
  }, [mol]);

  const frame = useCallback((m: MoleculeJSON) => {
    if (!m.atoms.length) return;
    const c = new THREE.Vector3();
    m.atoms.forEach((a) => c.add(new THREE.Vector3(...a.xyz)));
    c.divideScalar(m.atoms.length);
    const rad = Math.max(1.5, ...m.atoms.map((a) => new THREE.Vector3(...a.xyz).distanceTo(c))) + 1.5;
    rendererRef.current?.frameView(c.multiplyScalar(100), rad * 100);
  }, []);

  const load = (m: MoleculeJSON, note: string) => {
    setMol(m);
    setSelected([]);
    frame(m);
    log(note);
  };

  // ---- editing ---------------------------------------------------------------
  const downAt = useRef<[number, number] | null>(null);
  const onPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    // ignore clicks that end an orbit/pan drag
    const d = downAt.current;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4) return;
    const r = rendererRef.current;
    const layer = layerRef.current;
    if (!r || !display) return;
    const hit = layer?.atomsMesh ? r.pick(e.clientX, e.clientY, [layer.atomsMesh])[0] : undefined;
    const idx = hit?.instanceId;
    const cov = (s: string) => display.covalent_radius_angstrom[s] ?? 0.75;
    if (tool === "select") {
      if (idx === undefined) return setSelected([]);
      setSelected((s) => (s.includes(idx) ? s.filter((x) => x !== idx) : [...s, idx].slice(-4)));
    } else if (tool === "add") {
      if (idx === undefined) {
        const p = r.pointOnViewPlane(e.clientX, e.clientY);
        if (!p) return;
        setMol({ ...mol, atoms: [...mol.atoms, { symbol: element, xyz: [p.x / 100, p.y / 100, p.z / 100] }] });
      } else {
        // place the new atom at the sum of covalent radii, pointing away from existing neighbours
        const a = new THREE.Vector3(...mol.atoms[idx].xyz);
        const away = new THREE.Vector3();
        mol.bonds.forEach((b) => {
          const o = b.i === idx ? b.j : b.j === idx ? b.i : -1;
          if (o >= 0) away.add(a.clone().sub(new THREE.Vector3(...mol.atoms[o].xyz)).normalize());
        });
        if (away.lengthSq() < 1e-6) {
          away.set(1, 0, 0).applyQuaternion(r.activeCamera.quaternion);
          const nb = mol.bonds.find((b) => b.i === idx || b.j === idx);
          if (nb) away.cross(new THREE.Vector3(0, 0, 1).applyQuaternion(r.activeCamera.quaternion)).add(new THREE.Vector3(0.3, 0.2, 0.1));
        }
        away.normalize();
        const pos = a.clone().addScaledVector(away, cov(mol.atoms[idx].symbol) + cov(element));
        const n = mol.atoms.length;
        setMol({
          ...mol,
          atoms: [...mol.atoms, { symbol: element, xyz: [pos.x, pos.y, pos.z] }],
          bonds: [...mol.bonds, { i: idx, j: n, order: 1 }],
        });
      }
    } else if (tool === "delete" && idx !== undefined) {
      const atoms = mol.atoms.filter((_, k) => k !== idx);
      const bonds = mol.bonds
        .filter((b) => b.i !== idx && b.j !== idx)
        .map((b) => ({ ...b, i: b.i > idx ? b.i - 1 : b.i, j: b.j > idx ? b.j - 1 : b.j }));
      setSelected([]);
      setMol({ ...mol, atoms, bonds });
    } else if (tool === "bond" && idx !== undefined) {
      const sel = selected.includes(idx) ? [] : [...selected, idx];
      if (sel.length < 2) return setSelected(sel);
      const [i, j] = [Math.min(sel[0], sel[1]), Math.max(sel[0], sel[1])];
      const existing = mol.bonds.find((b) => b.i === i && b.j === j);
      let bonds = mol.bonds.filter((b) => !(b.i === i && b.j === j));
      if (!existing) bonds = [...bonds, { i, j, order: 1 }];
      else if (existing.order < 3) bonds = [...bonds, { i, j, order: existing.order >= 2 ? 3 : 2 }];
      log(existing ? (existing.order >= 3 ? `Removed bond ${i}–${j}` : `Bond ${i}–${j} order → ${existing.order >= 2 ? 3 : 2}`) : `Bonded ${i}–${j}`);
      setSelected([]);
      setMol({ ...mol, bonds });
    }
  };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) dispatch({ type: "undo" });
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) dispatch({ type: "redo" });
      else if (!mod && e.key === "s") setTool("select");
      else if (!mod && e.key === "a") setTool("add");
      else if (!mod && e.key === "d") setTool("delete");
      else if (!mod && e.key === "b") setTool("bond");
      else if (!mod && e.key === "f") frame(mol);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- calculations ---------------------------------------------------------
  const quantumBody = () => ({ molecule: mol, method, xc, basis, grid_points: 64 });
  const methodKey = `${method}${method === "DFT" ? `/${xc}` : ""}/${basis}`;

  const submit = async (kind: "scf" | "geomopt" | "scan") => {
    try {
      let j: Job<SCFResult | GeomOptResult | ScanResult>;
      if (kind === "scf") j = await molApi.scf(quantumBody());
      else if (kind === "geomopt") j = await molApi.geomopt(quantumBody());
      else {
        if (selected.length !== 2) throw new Error("select exactly two atoms (Select tool) to scan their distance");
        j = await molApi.scan({ ...quantumBody(), i: selected[0], j: selected[1], r_min: scanRange.min, r_max: scanRange.max, points: scanRange.points });
      }
      setJobMolKey(molKey);
      log(`Submitted ${kind} ${methodKey} (job ${j.id})`);
      if (j.state === "done") finish((await api.job(j.id)) as Job<SCFResult | GeomOptResult | ScanResult>);
      else setJob(j);
    } catch (e) {
      log(`Submit failed: ${(e as Error).message}`, "error");
    }
  };

  const finish = useCallback(
    (j: Job<SCFResult | GeomOptResult | ScanResult>) => {
      if (j.error) log(j.error, "error");
      setJob(j);
      if (j.state !== "done") return;
      if (j.cached) log("Loaded cached result (identical settings were run before).");
      if (j.kind === "geomopt") {
        const r = j.result as GeomOptResult;
        const optimised = { ...r.molecule, bonds: mol.bonds };
        setMol(optimised);
        setJobMolKey(JSON.stringify(optimised));
        log(`Optimised geometry loaded (E = ${r.energy_Eh.toFixed(8)} Eh)`);
        setTab("opt");
      }
      if (j.kind === "scan") setTab("scan");
      else setView((v) => (v === "none" ? "density" : v));
    },
    [log, mol.bonds, setMol],
  );

  useEffect(() => {
    if (!job || job.state !== "running") return;
    let seen = job.logs.length;
    const t = setInterval(async () => {
      try {
        const j = (await api.job(job.id)) as Job<SCFResult | GeomOptResult | ScanResult>;
        j.logs.slice(seen).forEach((l) => log(l.message));
        seen = j.logs.length;
        if (j.state !== "running") {
          clearInterval(t);
          finish(j);
        }
      } catch (e) {
        log(`Polling failed: ${(e as Error).message}`, "error");
        clearInterval(t);
      }
    }, 600);
    return () => clearInterval(t);
  }, [job, log, finish]);

  const scfResult = job?.state === "done" && job.kind !== "scan" ? (job.result as SCFResult | GeomOptResult) : undefined;
  const scanResult = job?.state === "done" && job.kind === "scan" ? (job.result as ScanResult) : undefined;
  const stale = !!scfResult && jobMolKey !== molKey;
  const opt = scfResult && "optimisation" in scfResult ? (scfResult as GeomOptResult).optimisation : null;

  // volume for the selected view
  useEffect(() => {
    if (!scfResult || !job || view === "none" || stale) {
      setField(null);
      return;
    }
    let live = true;
    const g = scfResult.grid;
    const base = { shape: g.shape as [number, number, number], originPm: g.origin_pm as [number, number, number], spacingPm: g.spacing_pm };
    const density = decodeArray(scfResult.volumes.density);
    const [, dmax] = minMax(density);
    const done = (f: VolumeField, title: string) => {
      if (!live) return;
      setField(f);
      setFieldTitle(title);
    };
    if (view === "density") done({ ...base, values: density, kind: "density", maxDensity: dmax }, "Electron density ρ (e/bohr³)");
    else if (view === "spin_density" && scfResult.volumes.spin_density) {
      const sd = decodeArray(scfResult.volumes.spin_density);
      const [lo, hi] = minMax(sd);
      done({ ...base, values: sd, kind: "signed", maxDensity: Math.max(-lo, hi) }, "Spin density ρα − ρβ (red > 0, blue < 0)");
    } else if (view === "orbital" && orbitalSel) {
      api.jobOrbital(job.id, orbitalSel.spin, orbitalSel.index).then((o) => {
        const v = decodeArray(o.volume);
        let mx = 0;
        for (const x of v) mx = Math.max(mx, x * x);
        done({ ...base, values: v, kind: "amplitude", maxDensity: mx }, `MO ${o.index} (${orbitalSel.spin}), ε = ${((o.energy_Eh ?? 0) * HARTREE_EV).toFixed(3)} eV, occupation ${o.occupation}`);
      }).catch((e) => log(`Orbital failed: ${e.message}`, "error"));
    } else if (view === "esp") {
      api.jobESP(job.id).then((r) => {
        const esp = decodeArray(r.volume);
        const iso = 0.001;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < density.length; i++)
          if (Math.abs(density[i] - iso) < 0.25 * iso) {
            lo = Math.min(lo, esp[i]);
            hi = Math.max(hi, esp[i]);
          }
        if (!isFinite(lo)) [lo, hi] = [r.min ?? 0, r.max ?? 1];
        done({ ...base, values: density, kind: "density+esp", aux: esp, auxRange: [lo, hi], maxDensity: dmax }, `ESP on ρ = 0.001 e/bohr³: ${(lo * HARTREE_EV).toFixed(2)} (blue) … ${(hi * HARTREE_EV).toFixed(2)} V (red)`);
      }).catch((e) => log(`ESP failed: ${e.message}`, "error"));
    }
    return () => {
      live = false;
    };
  }, [scfResult, job, view, orbitalSel, stale, log]);

  const threshold = useMemo(() => {
    if (!field) return 0;
    if (field.kind === "density+esp") return 0.001;
    const d = field.kind === "amplitude" ? field.values.map((v) => v * v) : field.kind === "signed" ? field.values.map(Math.abs) : field.values;
    return enclosedThreshold(d, fraction);
  }, [field, fraction]);

  useEffect(() => {
    rendererRef.current?.setField(field, false);
  }, [field]);
  useEffect(() => {
    rendererRef.current?.setDisplay({
      mode: field?.kind === "density+esp" ? "isosurface" : mode,
      densityThreshold: threshold,
      opacity,
      logScale: false,
      logDecades: 4,
      clip: { enabled: false, axis: 2, offsetPm: 0, flip: false },
      showAxes: false,
    });
  }, [field, threshold, mode, opacity]);

  // ---- derived ------------------------------------------------------------------
  const measurement = useMemo(() => {
    const p = selected.map((k) => mol.atoms[k]?.xyz).filter(Boolean) as number[][];
    if (p.length === 2) return `distance ${selected.join("–")}: ${formatLength(dist(p[0], p[1]) * 100, 5)}`;
    if (p.length === 3) return `angle ${selected.join("–")}: ${angleDeg(p[0], p[1], p[2]).toFixed(2)}°`;
    if (p.length === 4) return `dihedral ${selected.join("–")}: ${dihedralDeg(p[0], p[1], p[2], p[3]).toFixed(2)}°`;
    return null;
  }, [selected, mol]);

  const levelRows = useMemo(() => (scfResult ? scfResult.orbitals.filter((o) => o.energy_eV > -60 && o.energy_eV < 25) : []), [scfResult]);
  const levels: Level[] = levelRows.map((o) => ({
    energy: o.energy_eV,
    label: `${o.index}`,
    occupation: o.occupation,
    column: o.spin === "beta" ? 1 : 0,
    highlight: orbitalSel?.index === o.index && orbitalSel?.spin === o.spin,
  }));
  const homo = scfResult?.orbitals.filter((o) => o.occupation > 0 && o.spin !== "beta").at(-1);

  const saveSnapshot = () => {
    const e = scfResult && !stale ? scfResult.energy_Eh : null;
    setSnapshots((s) => [...s, { name: `config ${s.length + 1}`, molecule: mol, energyEh: e, methodKey: e !== null ? String(scfResult!.settings.method) + "/" + String(scfResult!.settings.basis) + (scfResult!.settings.method === "DFT" ? "/" + String(scfResult!.settings.xc) : "") : "—", formula: analysis?.formula ?? "?" }]);
  };

  const scaleBar = vi ? niceScaleBar(vi.pmPerPx) : null;

  return (
    <div className="workspace">
      <aside className="left panel">
        <h3>Build</h3>
        <div className="row">
          {(["select", "add", "delete", "bond"] as Tool[]).map((t) => (
            <button key={t} className={tool === t ? "primary" : ""} onClick={() => setTool(t)} title={`Shortcut: ${t[0].toUpperCase()}`}>
              {t === "select" ? "Select / measure" : t === "add" ? "Add atom" : t === "delete" ? "Delete" : "Bond"}
            </button>
          ))}
        </div>
        <div className="muted small">
          {tool === "add" && "Click an atom to bond a new atom to it, or empty space to place a free atom."}
          {tool === "bond" && "Click two atoms: creates a bond, then cycles order 1 → 2 → 3 → none."}
          {tool === "delete" && "Click an atom to remove it and its bonds."}
          {tool === "select" && "Click 2–4 atoms to measure distance, angle or dihedral."}
        </div>
        <label>
          Element
          <div className="row">
            {QUICK_ELEMENTS.map((s) => (
              <button key={s} className={element === s ? "primary" : ""} onClick={() => setElement(s)}>
                {s}
              </button>
            ))}
            <input style={{ width: 52 }} value={element} onChange={(e) => setElement(e.target.value.trim())} />
          </div>
        </label>
        <div className="row">
          <button onClick={() => molApi.addHydrogens(mol).then((r) => { setMol(r.molecule); log(`Added ${r.added} hydrogens (RDKit, estimated positions)`); }).catch((e) => log(e.message, "error"))} disabled={!mol.atoms.length}>
            Add hydrogens
          </button>
          <button onClick={() => molApi.analyze(mol, true).then((r) => { setMol(r.molecule); log("Bonds re-perceived from geometry (RDKit DetermineBonds)"); }).catch((e) => log(e.message, "error"))} disabled={mol.atoms.length < 2}>
            Bonds from geometry
          </button>
          <button onClick={() => { setMol(EMPTY); setSelected([]); }}>Clear</button>
        </div>
        <h3>Load</h3>
        <select value="" onChange={(e) => e.target.value && molApi.fromSmiles(examples[e.target.value]).then((r) => { load(r.molecule, `Loaded ${e.target.value}: ${r.geometry_method}`); setLastFF(r.geometry_method); })}>
          <option value="">Example molecules…</option>
          {Object.keys(examples).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <div className="row">
          <input placeholder="SMILES, e.g. CC(=O)O" value={smiles} onChange={(e) => setSmiles(e.target.value)} style={{ flex: 1 }} />
          <button onClick={() => molApi.fromSmiles(smiles).then((r) => { load(r.molecule, `Built ${smiles}: ${r.geometry_method}`); setLastFF(r.geometry_method); }).catch((e) => log(e.message, "error"))}>Build</button>
        </div>
        {lastFF && <div className="muted small">Starting geometry: {lastFF} (force-field quality, not quantum).</div>}
        <h3>Species</h3>
        <div className="grid2">
          <label>
            Charge
            <input type="number" value={mol.charge} onChange={(e) => setMol({ ...mol, charge: Number(e.target.value) })} />
          </label>
          <label>
            Multiplicity 2S+1
            <input type="number" min={1} value={mol.multiplicity} onChange={(e) => setMol({ ...mol, multiplicity: Math.max(1, Number(e.target.value)) })} />
          </label>
        </div>
        {analysis && (
          <table className="props">
            <tbody>
              <tr><th>Formula</th><td>{analysis.formula}</td></tr>
              <tr><th>Molar mass</th><td>{analysis.molecular_weight_g_mol.toFixed(3)} g/mol</td></tr>
              <tr><th>Electrons</th><td>{analysis.n_electrons}</td></tr>
              <tr><th>SMILES</th><td>{analysis.smiles ?? "—"}</td></tr>
              <tr><th>Lewis radicals</th><td>{analysis.radical_electrons_lewis}</td></tr>
            </tbody>
          </table>
        )}
        {analysis?.problems.map((p) => <div key={p} className="warn small">{p}</div>)}
        {analysis && (analysis.n_electrons - (mol.multiplicity - 1)) % 2 !== 0 && (
          <div className="warn small">Multiplicity {mol.multiplicity} is impossible with {analysis.n_electrons} electrons.</div>
        )}
        <h3>Objects</h3>
        <ul className="tree">
          {mol.atoms.map((a, k) => (
            <li key={k} className={selected.includes(k) ? "warn" : ""} onClick={() => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k].slice(-4)))}>
              {k} {a.symbol} ({a.xyz.map((x) => x.toFixed(3)).join(", ")}) Å
            </li>
          ))}
        </ul>
        <h3>File</h3>
        <div className="row">
          <button onClick={() => dispatch({ type: "undo" })} disabled={!hist.past.length}>Undo</button>
          <button onClick={() => dispatch({ type: "redo" })} disabled={!hist.future.length}>Redo</button>
          <button disabled={!mol.atoms.length} onClick={() => download(`${analysis?.formula ?? "molecule"}.xyz`, toXYZ(mol, `${analysis?.formula ?? ""} charge=${mol.charge} mult=${mol.multiplicity}`))}>XYZ</button>
          <button onClick={() => download(`molecule-${Date.now()}.json`, JSON.stringify({ application: "Chemical Modelling", workspace: "molecular", format_version: 1, saved_at: new Date().toISOString(), molecule: mol, snapshots, job: job ? { id: job.id, kind: job.kind, params: job.params } : null }, null, 2), "application/json")}>Save</button>
          <label className="button">
            Open
            <input type="file" hidden accept=".json,.xyz" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              f.text().then((t) => {
                try {
                  if (f.name.endsWith(".xyz")) {
                    const lines = t.trim().split(/\r?\n/);
                    const n = Number(lines[0]);
                    const atoms = lines.slice(2, 2 + n).map((l) => { const [s, x, y, z] = l.trim().split(/\s+/); return { symbol: s, xyz: [Number(x), Number(y), Number(z)] as [number, number, number] }; });
                    molApi.analyze({ atoms, bonds: [], charge: 0, multiplicity: 1 }, true).then((r) => load(r.molecule, `Opened ${f.name}; bonds perceived from geometry`));
                  } else {
                    const p = JSON.parse(t);
                    if (p.workspace !== "molecular") throw new Error("not a Molecular Builder project");
                    load(p.molecule, `Opened ${f.name} (saved ${p.saved_at})`);
                    setSnapshots(p.snapshots ?? []);
                    if (p.job?.id) api.job(p.job.id).then((j) => { setJob(j as Job<SCFResult>); setJobMolKey(JSON.stringify(p.molecule)); }).catch(() => log("Saved calculation not in local cache; re-run it.", "warn"));
                  }
                } catch (err) {
                  log(`Open failed: ${(err as Error).message}`, "error");
                }
              });
            }} />
          </label>
          <button onClick={() => rendererRef.current && download("molecule.png", dataURLtoBlob(rendererRef.current.exportPNG(3)))}>Image ×3</button>
        </div>
        <div className="muted small">Shortcuts: S select · A add · D delete · B bond · F frame · Ctrl+Z/Y</div>
      </aside>

      <Splitter variable="--left" direction={1} min={220} max={560} />
      <Splitter variable="--right" direction={-1} min={280} max={640} />
      <Splitter variable="--bottom" direction={-1} vertical min={120} max={600} />

      <main className="viewport-wrap" onPointerDown={(e) => (downAt.current = [e.clientX, e.clientY])} onClick={onPointer}>
        <div className="viewport" ref={viewportRef} />
        <div className="overlay top-left">
          {scfResult && !stale && <div className="badge computed">Computed: {scfResult.solver}/{String(scfResult.settings.basis)}{scfResult.settings.method === "DFT" ? `/${scfResult.settings.xc}` : ""}</div>}
          {stale && <div className="badge approx">Structure edited since the last calculation: results hidden</div>}
          {field && <div className="field-title">{fieldTitle}</div>}
          {field && field.kind !== "density+esp" && mode === "isosurface" && <div className="small muted">Isosurface encloses {(fraction * 100).toFixed(0)} % of the {field.kind === "signed" ? "|spin density|" : "probability"} on the grid</div>}
          {measurement && <div className="field-title">{measurement}</div>}
          {!mol.atoms.length && <div className="muted">Load an example or SMILES, or choose “Add atom” and click in the viewport.</div>}
        </div>
        <div className="overlay bottom-left">
          {scaleBar && (
            <div className="scalebar">
              <div className="bar" style={{ width: scaleBar.px }} />
              <span>{scaleBar.label}</span>
            </div>
          )}
          {display && <div className="small muted">Spheres: 0.35 × covalent radius (display only). Coordinates in Å.</div>}
        </div>
      </main>

      <aside className="right panel">
        <h3>Fast mode (force field)</h3>
        <button disabled={!mol.atoms.length} onClick={() => molApi.forceField(mol).then((r) => { setMol({ ...r.molecule, bonds: mol.bonds }); log(`${r.method}: ${r.initial_energy_kcal_mol.toFixed(3)} → ${r.final_energy_kcal_mol.toFixed(3)} kcal/mol${r.converged ? "" : " (not converged)"}. ${r.notes}`); }).catch((e) => log(e.message, "error"))}>
          Clean up geometry (MMFF94 / UFF)
        </button>
        <div className="muted small">Classical force field: quick, approximate geometry. Use the quantum methods below for energies.</div>

        <h3>Accurate mode (PySCF)</h3>
        <div className="grid2">
          <label>
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as "HF" | "DFT")}>
              <option value="HF">Hartree–Fock</option>
              <option value="DFT">DFT</option>
            </select>
          </label>
          {method === "DFT" && (
            <label>
              Functional
              <select value={xc} onChange={(e) => setXc(e.target.value)}>
                {["LDA", "PBE", "B3LYP", "PBE0", "wB97X-D"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          )}
          <label>
            Basis
            <select value={basis} onChange={(e) => setBasis(e.target.value)}>
              {["sto-3g", "6-31g", "6-31g*", "cc-pvdz", "cc-pvtz", "def2-svp", "def2-tzvp"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={!mol.atoms.length || job?.state === "running"} onClick={() => submit("scf")}>Single point</button>
          <button className="primary" disabled={!mol.atoms.length || job?.state === "running"} onClick={() => submit("geomopt")}>Optimise geometry</button>
          {job?.state === "running" && <button onClick={() => api.cancelJob(job.id).then((j) => setJob(j as Job<SCFResult>))}>Cancel</button>}
        </div>
        <div className="muted small">Semiempirical (balanced) mode: not installed; see docs/LIMITATIONS.md.</div>
        <details>
          <summary className="small">Bond scan (energy vs distance)</summary>
          <div className="grid3">
            <label>r min (Å)<input type="number" step={0.05} value={scanRange.min} onChange={(e) => setScanRange({ ...scanRange, min: Number(e.target.value) })} /></label>
            <label>r max (Å)<input type="number" step={0.05} value={scanRange.max} onChange={(e) => setScanRange({ ...scanRange, max: Number(e.target.value) })} /></label>
            <label>points<input type="number" value={scanRange.points} onChange={(e) => setScanRange({ ...scanRange, points: Number(e.target.value) })} /></label>
          </div>
          <button disabled={selected.length !== 2 || job?.state === "running"} onClick={() => submit("scan")}>Scan selected bond {selected.length === 2 ? selected.join("–") : ""}</button>
        </details>
        {job && <div className="small muted">Job {job.kind}: {job.state}{job.cached ? " (cached)" : ""} · {job.elapsed_s.toFixed(1)} s</div>}

        {scfResult && (
          <>
            <table className="props">
              <tbody>
                <tr><th>Total energy</th><td>{scfResult.energy_Eh.toFixed(8)} Eh</td></tr>
                <tr><th>SCF</th><td>{scfResult.converged ? `converged, ${scfResult.cycles.length} cycles` : "NOT converged"}</td></tr>
                {opt && <tr><th>Optimisation</th><td>{opt.converged ? "converged" : "NOT converged"}, {opt.steps.length} steps (fmax {opt.fmax_eV_per_A} eV/Å)</td></tr>}
                <tr><th>HOMO–LUMO gap</th><td>{scfResult.homo_lumo_gap_eV?.toFixed(3) ?? "—"} eV</td></tr>
                <tr><th>Dipole moment</th><td>{Math.hypot(...scfResult.dipole_debye).toFixed(3)} D</td></tr>
                {scfResult.s_squared !== null && <tr><th>⟨S²⟩</th><td>{scfResult.s_squared.toFixed(4)}</td></tr>}
                <tr><th>Basis functions</th><td>{scfResult.n_basis_functions}</td></tr>
                <tr><th>Wall time</th><td>{scfResult.wall_time_s.toFixed(2)} s</td></tr>
              </tbody>
            </table>
            {scfResult.warnings.map((w) => <div key={w} className="warn small">{w}</div>)}
            <h3>Mulliken charges</h3>
            <table className="props">
              <tbody>
                {scfResult.mulliken_charges.map((q, k) => (
                  <tr key={k}><th>{k} {scfResult.atoms?.[k]?.[0]}</th><td>{q >= 0 ? "+" : ""}{q.toFixed(3)} e</td></tr>
                ))}
              </tbody>
            </table>
            <div className="muted small">Mulliken populations are basis-set dependent.</div>
          </>
        )}

        <h3>Visualise</h3>
        <div className="grid2">
          <label>
            Field
            <select value={view} onChange={(e) => setView(e.target.value as View)} disabled={!scfResult || stale}>
              <option value="none">Structure only</option>
              <option value="density">Electron density</option>
              {scfResult?.volumes.spin_density && <option value="spin_density">Spin density</option>}
              <option value="orbital">Molecular orbital</option>
              <option value="esp">Electrostatic potential</option>
            </select>
          </label>
          <label>
            Rendering
            <select value={mode} onChange={(e) => setMode(e.target.value as "volume" | "isosurface")}>
              <option value="isosurface">Isosurface</option>
              <option value="volume">Volumetric</option>
            </select>
          </label>
        </div>
        {view === "orbital" && homo && (
          <div className="row">
            <button onClick={() => setOrbitalSel({ spin: homo.spin, index: homo.index })}>HOMO</button>
            <button onClick={() => setOrbitalSel({ spin: homo.spin, index: homo.index + 1 })}>LUMO</button>
            <span className="small muted">or click a level in “MO diagram”.</span>
          </div>
        )}
        <label>
          Enclosed fraction {(fraction * 100).toFixed(0)} %
          <input type="range" min={0.1} max={0.99} step={0.01} value={fraction} onChange={(e) => setFraction(Number(e.target.value))} />
        </label>
        <label>
          Opacity {opacity.toFixed(2)}
          <input type="range" min={0.05} max={mode === "volume" ? 5 : 1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
        </label>

        <h3>Compare configurations</h3>
        <button disabled={!mol.atoms.length} onClick={saveSnapshot}>Save current configuration</button>
        {snapshots.length > 0 && (
          <table className="props compare">
            <thead><tr><th>Name</th><th>Method</th><th>E (Eh)</th><th>ΔE (kJ/mol)</th><th /></tr></thead>
            <tbody>
              {snapshots.map((s, k) => {
                const same = snapshots.filter((x) => x.methodKey === s.methodKey && x.energyEh !== null && x.formula === s.formula);
                const ref = Math.min(...same.map((x) => x.energyEh as number));
                return (
                  <tr key={k}>
                    <td>{s.name} ({s.formula})</td>
                    <td>{s.methodKey}</td>
                    <td>{s.energyEh?.toFixed(6) ?? "—"}</td>
                    <td>{s.energyEh !== null && same.length > 1 ? ((s.energyEh - ref) * KJ_PER_HARTREE).toFixed(2) : "—"}</td>
                    <td><button className="small" onClick={() => load(s.molecule, `Restored ${s.name}`)}>load</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="muted small">ΔE is only shown between configurations with the same formula and method.</div>
      </aside>

      <section className="bottom panel">
        <nav className="tabs">
          {[["console", "Console"], ["mo", "MO diagram"], ["opt", "Optimisation"], ["scan", "Bond scan"], ["conv", "SCF convergence"]].map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="tab-body">
          {tab === "console" && <Console entries={entries} onClear={clear} />}
          {tab === "mo" &&
            (scfResult && !stale ? (
              <div className="two-col">
                <EnergyDiagram
                  title={`${scfResult.solver} orbital energies (−60 to 25 eV)`}
                  columns={scfResult.orbitals.some((o) => o.spin === "beta") ? ["α", "β"] : ["orbitals"]}
                  levels={levels}
                  onPick={(i) => {
                    const o = levelRows[i];
                    setOrbitalSel({ spin: o.spin, index: o.index });
                    setView("orbital");
                  }}
                />
                <div className="small muted">Click a level to show that orbital. Blue: occupied, grey: virtual. Labels are orbital indices; hover for energies.</div>
              </div>
            ) : <div className="muted">Run a calculation to see molecular orbital energies.</div>)}
          {tab === "opt" &&
            (scfResult && opt ? (
              <div className="two-col">
                <LineChart title="Energy during optimisation" series={[{ name: "E", x: opt.steps.map((s) => s.step), y: opt.steps.map((s) => (s.energy_Eh - scfResult.energy_Eh) * KJ_PER_HARTREE) }]} xLabel="step" yLabel="E − E_final (kJ/mol)" csvName="optimisation-energy" />
                <LineChart title="Maximum force" series={[{ name: "fmax", x: opt.steps.map((s) => s.step), y: opt.steps.map((s) => s.fmax_eV_per_A) }]} xLabel="step" yLabel="max |F| (eV/Å)" csvName="optimisation-force" />
              </div>
            ) : <div className="muted">Run “Optimise geometry” to see convergence.</div>)}
          {tab === "scan" &&
            (scanResult ? (
              <div className="two-col">
                <LineChart
                  title={`Energy vs distance, atoms ${scanResult.bond.join("–")} (${scanResult.method})`}
                  series={[{ name: "E", x: scanResult.points.map((p) => p.r_angstrom), y: scanResult.points.map((p) => (p.energy_Eh - scanResult.minimum_on_grid.energy_Eh) * KJ_PER_HARTREE) }]}
                  xLabel="r (Å)"
                  yLabel="E − E_min (kJ/mol)"
                  markers={[{ x: scanResult.minimum_on_grid.r_angstrom, label: `min ${scanResult.minimum_on_grid.r_angstrom.toFixed(3)} Å`, color: "#9ad25a" }]}
                  csvName="bond-scan"
                />
                <div className="small muted">{scanResult.notes}</div>
              </div>
            ) : <div className="muted">Select two atoms and run a bond scan.</div>)}
          {tab === "conv" &&
            (scfResult ? (
              <LineChart title="SCF convergence (final geometry)" series={[{ name: "ΔE", x: scfResult.cycles.map((c) => c.cycle), y: scfResult.cycles.map((c) => Math.log10(Math.max(Math.abs(c.energy_Eh - scfResult.energy_Eh), 1e-14))) }]} xLabel="SCF cycle" yLabel="log₁₀ |ΔE| (Eh)" csvName="scf-convergence" />
            ) : <div className="muted">Run a calculation first.</div>)}
        </div>
      </section>
    </div>
  );
}
