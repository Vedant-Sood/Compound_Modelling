// MODE A - Atomic Explorer: element data, analytic and SCF electron densities.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  api,
  decodeArray,
  type ElementDetail,
  type ElementSummary,
  type HydrogenicOrbital,
  type Job,
  type Levels,
  type OrbitalModel,
  type RadialData,
} from "../api/client";
import { VolumeRenderer, type VolumeField, type ViewInfo } from "../render/VolumeRenderer";
import { writeCube } from "../science/cube";
import { enclosedThreshold, minMax } from "../science/threshold";
import { formatLength, niceScaleBar, representationLevel, HARTREE_EV } from "../science/units";
import { autosave, historyReducer, loadAutosave, type AtomicState } from "../state/atomic";
import { ConfigurationView, ElementHeader, PropertyTable, provenance } from "./ElementPanel";
import { EnergyDiagram, type Level } from "./EnergyDiagram";
import { LineChart, download } from "./LineChart";
import { PeriodicTable } from "./PeriodicTable";
import { SliceView } from "./SliceView";
import { Splitter } from "./Splitter";
import { useLog, type LogEntry } from "./useLog";

const L_LETTERS = "spdfghik";
const AXES = ["x", "y", "z"] as const;

interface Badge {
  text: string;
  tone: "exact" | "approx" | "computed";
}

export function AtomicExplorer({ elements }: { elements: ElementSummary[] }) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: loadAutosave(),
    future: [],
  }));
  const s = hist.present;
  const set = useCallback(
    (patch: Partial<AtomicState>, transient = false) => dispatch({ type: "set", patch, transient }),
    [],
  );
  const { log, entries, clear } = useLog();

  const [detail, setDetail] = useState<ElementDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [compareDetail, setCompareDetail] = useState<ElementDetail | null>(null);
  const [models, setModels] = useState<OrbitalModel[]>([]);
  const [orbital, setOrbital] = useState<HydrogenicOrbital | null>(null);
  const [radial, setRadial] = useState<RadialData | null>(null);
  const [levels, setLevels] = useState<Levels | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [field, setField] = useState<VolumeField | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [badge, setBadge] = useState<Badge | null>(null);
  const [fieldTitle, setFieldTitle] = useState("");
  const [view, setView] = useState<ViewInfo | null>(null);
  const [bottomTab, setBottomTab] = useState("console");
  const [busy, setBusy] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VolumeRenderer | null>(null);
  const firstField = useRef(true);

  useEffect(() => autosave(s), [s]);

  // ---- renderer lifecycle ------------------------------------------------
  useEffect(() => {
    const el = viewportRef.current!;
    const r = new VolumeRenderer(el);
    let last = 0;
    r.onView = (v) => {
      const now = performance.now();
      if (now - last > 60) {
        last = now;
        setView(v);
      }
    };
    rendererRef.current = r;
    return () => r.dispose();
  }, []);

  useEffect(() => {
    rendererRef.current?.setField(field, firstField.current && !!field);
    if (field) firstField.current = false;
  }, [field]);

  useEffect(() => rendererRef.current?.setOrthographic(s.orthographic), [s.orthographic]);

  useEffect(() => {
    rendererRef.current?.setDisplay({
      mode: s.mode,
      densityThreshold: threshold,
      opacity: s.opacity,
      logScale: s.logScale,
      logDecades: s.logDecades,
      clip: { enabled: s.clipEnabled, axis: s.clipAxis, offsetPm: s.clipOffsetPm, flip: s.clipFlip },
      showAxes: s.showAxes,
    });
  }, [field, threshold, s.mode, s.opacity, s.logScale, s.logDecades, s.clipEnabled, s.clipAxis, s.clipOffsetPm, s.clipFlip, s.showAxes]);

  // ---- element data -------------------------------------------------------
  useEffect(() => {
    let live = true;
    setDetailError(null);
    Promise.all([api.element(s.symbol, s.charge, s.massNumber), api.orbitalModels(s.symbol, s.charge)])
      .then(([d, m]) => {
        if (!live) return;
        setDetail(d);
        setModels(m.models);
        const kinds = m.models.map((x) => x.model);
        if (!kinds.includes(s.model)) set({ model: kinds[0] ?? "scf" }, true);
      })
      .catch((e) => live && setDetailError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [s.symbol, s.charge, s.massNumber, s.model, set]);

  useEffect(() => {
    if (!s.compare) return setCompareDetail(null);
    api.element(s.compare, 0).then(setCompareDetail).catch(() => setCompareDetail(null));
  }, [s.compare]);

  const nuclearRadiusPm = useMemo(() => {
    const v = detail?.properties.nuclear_radius_estimate?.value as number | null | undefined;
    if (v) return v * 1e-3;
    const mass = detail?.summary.atomic_mass_u;
    return mass ? 1.2 * Math.cbrt(Math.round(mass)) * 1e-3 : 0;
  }, [detail]);
  useEffect(() => rendererRef.current?.setNucleusRadiusPm(nuclearRadiusPm), [nuclearRadiusPm]);

  const slater = models.find((m) => m.model === "hydrogenic-slater");
  const subshell = slater?.subshells?.find((x) => x.n === s.n && x.l === s.l) ?? slater?.subshells?.at(-1);

  // ---- hydrogen-like orbitals -----------------------------------------------
  useEffect(() => {
    if (!detail || s.model === "scf") return;
    const exact = s.model === "hydrogenic-exact";
    if (!exact && !subshell) return;
    const n = exact ? s.n : subshell!.n;
    const l = exact ? s.l : subshell!.l;
    const m = Math.max(-l, Math.min(l, s.m));
    const Z = exact ? detail.summary.Z : subshell!.zeff;
    const nucleus = exact ? { symbol: detail.summary.symbol, mass_number: s.massNumber } : {};
    let live = true;
    setBusy(true);
    const t0 = performance.now();
    Promise.all([
      api.hydrogenic({ n, l, m, Z, basis: s.basis, points: s.points, ...nucleus }),
      api.radial({ n, l, Z, ...nucleus }),
      exact ? api.levels({ Z, n_max: 7, ...nucleus }) : Promise.resolve(null),
    ])
      .then(([orb, rad, lev]) => {
        if (!live) return;
        setOrbital(orb);
        setRadial(rad);
        setLevels(lev);
        const density = decodeArray(orb.volumes.density);
        const g = orb.grid;
        const base = {
          shape: g.shape as [number, number, number],
          originPm: g.origin_pm as [number, number, number],
          spacingPm: g.spacing_pm,
          maxDensity: orb.max_density,
        };
        let f: VolumeField;
        if (orb.basis === "complex")
          f = { ...base, values: density, kind: "density+phase", aux: decodeArray(orb.volumes.phase!) };
        else if (s.quantity === "amplitude") f = { ...base, values: decodeArray(orb.volumes.amplitude!), kind: "amplitude" };
        else f = { ...base, values: density, kind: "density" };
        setField(f);
        setThreshold(enclosedThreshold(density, s.enclosedFraction));
        const what = orb.basis === "complex" ? "|ψ|² coloured by phase arg ψ" : s.quantity === "amplitude" ? "amplitude ψ (sign = phase)" : "probability density |ψ|²";
        setFieldTitle(`${orb.label} · ${what}`);
        setBadge(
          exact
            ? { text: `Exact analytic one-electron solution (Z = ${Z})`, tone: "exact" }
            : { text: `Approximation: hydrogen-like ${subshell!.subshell} with Slater Z_eff = ${Z}`, tone: "approx" },
        );
        log(`Evaluated ${orb.label} on ${g.shape.join("×")} grid in ${(performance.now() - t0).toFixed(0)} ms; grid holds ${((g.riemann_probability ?? 0) * 100).toFixed(2)} % of the probability`);
      })
      .catch((e) => live && log(`Orbital request failed: ${e.message ?? e}`, "error"))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, s.model, s.n, s.l, s.m, s.basis, s.quantity, s.points, subshell?.subshell, subshell?.zeff]);

  // threshold follows the enclosed fraction
  useEffect(() => {
    if (!field) return;
    if (field.kind === "density+esp") return setThreshold(s.espSurfaceDensity);
    const dens =
      field.kind === "amplitude"
        ? field.values.map((v) => v * v)
        : field.kind === "signed"
          ? field.values.map((v) => Math.abs(v))
          : field.values;
    setThreshold(enclosedThreshold(dens, s.enclosedFraction));
  }, [field, s.enclosedFraction, s.espSurfaceDensity]);

  // ---- SCF -----------------------------------------------------------------
  const runSCF = async () => {
    if (!detail) return;
    const body = {
      atoms: [[detail.summary.symbol, [0, 0, 0]]],
      method: s.scfMethod,
      xc: s.scfXc,
      basis: s.scfBasis,
      charge: s.charge,
      spin: s.scfSpin ?? detail.unpaired_electrons_hund,
      grid_points: Math.min(s.points, 96),
    };
    try {
      const j = await api.submitSCF(body);
      setJob(j);
      log(`Submitted ${s.scfMethod}${s.scfMethod === "DFT" ? `/${s.scfXc}` : ""}/${s.scfBasis} for ${detail.summary.symbol}${s.charge ? ` (charge ${s.charge})` : ""}, 2S = ${body.spin} (job ${j.id})`);
    } catch (e) {
      log(`Submit failed: ${(e as Error).message}`, "error");
    }
  };

  useEffect(() => {
    if (!job || job.state !== "running") return;
    let seen = job.logs.length;
    const timer = setInterval(async () => {
      try {
        const j = await api.job(job.id);
        j.logs.slice(seen).forEach((l) => log(l.message));
        seen = j.logs.length;
        if (j.state !== "running") {
          clearInterval(timer);
          if (j.error) log(j.error, "error");
          setJob(j);
        }
      } catch (e) {
        log(`Polling failed: ${(e as Error).message}`, "error");
        clearInterval(timer);
      }
    }, 600);
    return () => clearInterval(timer);
  }, [job, log]);

  const result = job?.state === "done" ? job.result : undefined;

  useEffect(() => {
    if (s.model !== "scf" || !result || !job) return;
    let live = true;
    const g = result.grid;
    const base = {
      shape: g.shape as [number, number, number],
      originPm: g.origin_pm as [number, number, number],
      spacingPm: g.spacing_pm,
    };
    const method = `${result.solver}/${String(result.settings.basis)}${result.settings.method === "DFT" ? `/${result.settings.xc}` : ""}`;
    const density = decodeArray(result.volumes.density);
    const [, dmax] = minMax(density);
    setOrbital(null);
    setLevels(null);
    setRadial(null);
    const done = (f: VolumeField, title: string) => {
      if (!live) return;
      setField(f);
      setFieldTitle(title);
      setBadge({ text: `Computed: ${method}, E = ${result.energy_Eh.toFixed(6)} Eh${result.converged ? "" : " (NOT converged)"}`, tone: "computed" });
    };
    if (s.scfView === "density") done({ ...base, values: density, kind: "density", maxDensity: dmax }, `Total electron density ρ (e/bohr³)${result.ecp ? ", valence only (ECP)" : ""}`);
    else if (s.scfView === "spin_density" && result.volumes.spin_density) {
      const sd = decodeArray(result.volumes.spin_density);
      const [lo, hi] = minMax(sd);
      done({ ...base, values: sd, kind: "signed", maxDensity: Math.max(-lo, hi) }, "Spin density ρα − ρβ (red > 0, blue < 0)");
    } else if (s.scfView === "orbital" && s.scfOrbital) {
      api
        .jobOrbital(job.id, s.scfOrbital.spin, s.scfOrbital.index)
        .then((o) => {
          const v = decodeArray(o.volume);
          let mx = 0;
          for (const x of v) mx = Math.max(mx, x * x);
          done(
            { ...base, values: v, kind: "amplitude", maxDensity: mx },
            `MO ${o.index} (${s.scfOrbital!.spin}) ψ, ε = ${((o.energy_Eh ?? 0) * HARTREE_EV).toFixed(3)} eV, occ ${o.occupation}`,
          );
        })
        .catch((e) => log(`Orbital evaluation failed: ${e.message}`, "error"));
    } else if (s.scfView === "esp") {
      log("Evaluating electrostatic potential on the grid…");
      api
        .jobESP(job.id)
        .then((r) => {
          const esp = decodeArray(r.volume);
          // colour range from ESP values on the chosen density surface
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = 0; i < density.length; i++) {
            if (Math.abs(density[i] - s.espSurfaceDensity) < 0.25 * s.espSurfaceDensity) {
              lo = Math.min(lo, esp[i]);
              hi = Math.max(hi, esp[i]);
            }
          }
          if (!isFinite(lo)) [lo, hi] = [r.min ?? 0, r.max ?? 1];
          done(
            { ...base, values: density, kind: "density+esp", aux: esp, auxRange: [lo, hi], maxDensity: dmax },
            `ESP on ρ = ${s.espSurfaceDensity} e/bohr³ surface: ${(lo * HARTREE_EV).toFixed(3)} … ${(hi * HARTREE_EV).toFixed(3)} V`,
          );
          log(`ESP range on surface ${lo.toExponential(3)} … ${hi.toExponential(3)} hartree/e`);
        })
        .catch((e) => log(`ESP failed: ${e.message}`, "error"));
    }
    return () => {
      live = false;
    };
  }, [s.model, s.scfView, s.scfOrbital, s.espSurfaceDensity, result, job, log]);

  // ---- keyboard shortcuts ----------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) dispatch({ type: "undo" });
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) dispatch({ type: "redo" });
      else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject();
      } else if (!mod && e.key === "r") rendererRef.current?.resetView();
      else if (!mod && e.key === "o") set({ orthographic: !s.orthographic });
      else if (!mod && e.key === "i") set({ mode: s.mode === "volume" ? "isosurface" : "volume" });
      else if (!mod && e.key === "c") set({ clipEnabled: !s.clipEnabled });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- save / load / export ----------------------------------------------------
  const saveProject = () => {
    const project = {
      application: "Chemical Modelling",
      format_version: 1,
      saved_at: new Date().toISOString(),
      workspace: "atomic",
      state: s,
      provenance: {
        badge: badge?.text,
        field: fieldTitle,
        orbital_method: orbital?.method,
        scf_job: job ? { id: job.id, params: job.params, energy_Eh: job.result?.energy_Eh, converged: job.result?.converged } : null,
        element_sources: detail?.sources,
      },
    };
    download(`chemmodel-${s.symbol}-${Date.now()}.json`, JSON.stringify(project, null, 2), "application/json");
    log("Project saved (settings, provenance and SCF job reference).");
  };

  const loadProject = (file: File) => {
    file.text().then((t) => {
      try {
        const p = JSON.parse(t);
        if (p.application !== "Chemical Modelling" || p.workspace !== "atomic") throw new Error("not an Atomic Explorer project");
        dispatch({ type: "load", state: p.state });
        if (p.provenance?.scf_job?.id)
          api.job(p.provenance.scf_job.id).then(setJob).catch(() => log("SCF result not in local cache; re-run the calculation.", "warn"));
        log(`Loaded project saved ${p.saved_at}`);
      } catch (e) {
        log(`Could not load project: ${(e as Error).message}`, "error");
      }
    });
  };

  const exportCube = () => {
    if (!field || !detail) return;
    const txt = writeCube(fieldTitle, field.values, field.shape, field.originPm, field.spacingPm, [
      { Z: detail.summary.Z, positionPm: [0, 0, 0] },
    ]);
    download(`${s.symbol}-${Date.now()}.cube`, txt);
  };

  // ---- derived display data ----------------------------------------------------
  const scaleBar = view ? niceScaleBar(view.pmPerPx) : null;
  const level = view ? representationLevel(view.viewWidthPm) : null;
  const halfWidth = field ? ((field.shape[0] - 1) * field.spacingPm) / 2 : 500;
  const exact = s.model === "hydrogenic-exact";

  const scfLevels: Level[] = useMemo(() => {
    if (!result) return [];
    return result.orbitals
      .filter((o) => o.energy_eV > -120 && o.energy_eV < 30)
      .map((o) => ({
        energy: o.energy_eV,
        label: `${o.index} ${o.character[0]?.ao.split(" ").slice(1).join(" ") ?? ""}`,
        occupation: o.occupation,
        column: o.spin === "beta" ? 1 : 0,
        highlight: s.scfOrbital?.index === o.index && s.scfOrbital?.spin === o.spin,
      }));
  }, [result, s.scfOrbital]);
  const scfLevelSource = useMemo(
    () => (result ? result.orbitals.filter((o) => o.energy_eV > -120 && o.energy_eV < 30) : []),
    [result],
  );

  return (
    <div className="workspace">
      {/* ---------------- left sidebar ---------------- */}
      <aside className="left panel">
        <h3>Periodic table</h3>
        <PeriodicTable
          elements={elements}
          selected={s.symbol}
          compare={s.compare}
          onSelect={(sym) => set({ symbol: sym, charge: 0, massNumber: null, scfOrbital: null })}
        />
        <div className="legend muted small">Click an element to explore it. Colours show chemical series.</div>
        <h3>Objects</h3>
        <ul className="tree">
          <li>
            Atom {s.symbol}
            {s.charge ? ` (charge ${s.charge > 0 ? "+" : ""}${s.charge})` : ""}
            <ul>
              <li>Nucleus (r ≈ {formatLength(nuclearRadiusPm, 3)})</li>
              <li>{fieldTitle || "No field loaded"}</li>
            </ul>
          </li>
        </ul>
        <h3>Project</h3>
        <div className="row">
          <button onClick={saveProject} title="Ctrl+S">Save</button>
          <label className="button">
            Open
            <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && loadProject(e.target.files[0])} />
          </label>
          <button onClick={() => dispatch({ type: "undo" })} disabled={!hist.past.length} title="Ctrl+Z">Undo</button>
          <button onClick={() => dispatch({ type: "redo" })} disabled={!hist.future.length} title="Ctrl+Y">Redo</button>
        </div>
        <div className="row">
          <button onClick={() => rendererRef.current && download(`${s.symbol}-view.png`, dataURLtoBlob(rendererRef.current.exportPNG(3)))}>Image ×3</button>
          <button onClick={exportCube} disabled={!field}>CUBE</button>
        </div>
        <div className="muted small">Shortcuts: R reset view · O ortho/persp · I iso/volume · C clip</div>
      </aside>

      <Splitter variable="--left" direction={1} min={220} max={560} />
      <Splitter variable="--right" direction={-1} min={280} max={640} />
      <Splitter variable="--bottom" direction={-1} vertical min={120} max={600} />

      {/* ---------------- viewport ---------------- */}
      <main className="viewport-wrap">
        <div className="viewport" ref={viewportRef} />
        <div className="overlay top-left">
          {badge && <div className={`badge ${badge.tone}`}>{badge.text}</div>}
          <div className="field-title">{fieldTitle}</div>
          {s.mode === "isosurface" && field && (
            <div className="small muted">
              {field.kind === "density+esp"
                ? `Isosurface ρ = ${s.espSurfaceDensity} e/bohr³, coloured by ESP (blue low, red high)`
                : `Isosurface encloses ${(s.enclosedFraction * 100).toFixed(0)} % of the ${field.kind === "signed" ? "|spin density|" : "probability"} on the grid`}
            </div>
          )}
          {busy && <div className="small">Computing…</div>}
        </div>
        <div className="overlay bottom-left">
          {scaleBar && (
            <div className="scalebar">
              <div className="bar" style={{ width: scaleBar.px }} />
              <span>{scaleBar.label}</span>
            </div>
          )}
          {view && (
            <div className="small muted">
              View width {formatLength(view.viewWidthPm)} · {view.orthographic ? "orthographic" : "perspective"}
            </div>
          )}
        </div>
        <div className="overlay bottom-right">
          {level && (
            <div className="small">
              <b>{level.level}</b>
              {level.note && <div className="muted">{level.note}</div>}
            </div>
          )}
          {view && view.nucleusExaggeration > 1.01 && (
            <div className="small warn">
              Nucleus enlarged ×{view.nucleusExaggeration.toExponential(1)} for visibility (estimated radius {formatLength(nuclearRadiusPm)}). Zoom in to reach its true size.
            </div>
          )}
          {s.showAxes && <div className="small muted">Axes: x red · y green · z blue</div>}
        </div>
      </main>

      {/* ---------------- right sidebar ---------------- */}
      <aside className="right panel">
        {detailError && <div className="error">{detailError}</div>}
        {detail && (
          <>
            <ElementHeader detail={detail} />
            {detail.superheavy_note && <div className="warn small">{detail.superheavy_note}</div>}
            <section>
              <h3>Species</h3>
              <div className="grid2">
                <label>
                  Charge
                  <input
                    type="number"
                    value={s.charge}
                    min={-3}
                    max={detail.summary.Z}
                    onChange={(e) => set({ charge: Math.max(-3, Math.min(detail.summary.Z, Number(e.target.value))), scfOrbital: null })}
                  />
                </label>
                <label>
                  Isotope
                  <select
                    value={s.massNumber ?? ""}
                    onChange={(e) => set({ massNumber: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">most abundant</option>
                    {detail.isotopes.map((i) => (
                      <option key={i.mass_number} value={i.mass_number}>
                        {detail.summary.symbol}-{i.mass_number}
                        {i.abundance_percent ? ` (${i.abundance_percent}%)` : i.is_stable ? " (stable)" : i.half_life ? ` (t½ ${i.half_life} ${i.half_life_unit})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
            <section>
              <h3>Electronic configuration</h3>
              <ConfigurationView detail={detail} />
            </section>
          </>
        )}

        <section>
          <h3>Orbital model</h3>
          <select value={s.model} onChange={(e) => set({ model: e.target.value as AtomicState["model"] })}>
            {models.map((m) => (
              <option key={m.model} value={m.model}>
                {m.model === "hydrogenic-exact" ? "Exact hydrogen-like (analytic)" : m.model === "hydrogenic-slater" ? "Slater-screened hydrogenic (approximate)" : "SCF calculation (PySCF)"}
              </option>
            ))}
          </select>
          <div className="muted small">{models.find((m) => m.model === s.model)?.description}</div>

          {exact && (
            <div className="grid3">
              <label>
                n
                <input type="number" min={1} max={8} value={s.n} onChange={(e) => set({ n: Number(e.target.value) })} />
              </label>
              <label>
                l ({L_LETTERS[s.l]})
                <input type="number" min={0} max={s.n - 1} value={s.l} onChange={(e) => set({ l: Number(e.target.value) })} />
              </label>
              <label>
                m
                <input type="number" min={-s.l} max={s.l} value={s.m} onChange={(e) => set({ m: Number(e.target.value) })} />
              </label>
            </div>
          )}
          {s.model === "hydrogenic-slater" && slater?.subshells && (
            <div className="grid2">
              <label>
                Subshell
                <select
                  value={`${subshell?.n},${subshell?.l}`}
                  onChange={(e) => {
                    const [n, l] = e.target.value.split(",").map(Number);
                    set({ n, l, m: 0 });
                  }}
                >
                  {slater.subshells.map((x) => (
                    <option key={x.subshell} value={`${x.n},${x.l}`}>
                      {x.subshell} (Z_eff {x.zeff})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                m
                <input type="number" min={-(subshell?.l ?? 0)} max={subshell?.l ?? 0} value={s.m} onChange={(e) => set({ m: Number(e.target.value) })} />
              </label>
            </div>
          )}
          {s.model !== "scf" && (
            <div className="grid2">
              <label>
                Angular basis
                <select value={s.basis} onChange={(e) => set({ basis: e.target.value as "real" | "complex" })}>
                  <option value="real">real (p_x, d_xy, …)</option>
                  <option value="complex">complex (e^{"{imφ}"})</option>
                </select>
              </label>
              <label>
                Quantity
                <select value={s.quantity} disabled={s.basis === "complex"} onChange={(e) => set({ quantity: e.target.value as "density" | "amplitude" })}>
                  <option value="density">probability density |ψ|²</option>
                  <option value="amplitude">amplitude ψ (with sign)</option>
                </select>
              </label>
            </div>
          )}
          {orbital && s.model !== "scf" && (
            <table className="props">
              <tbody>
                <tr><th>Orbital</th><td>{orbital.label}</td></tr>
                <tr><th>Energy</th><td>{orbital.energy_eV.toFixed(6)} eV{exact ? "" : " (Slater estimate)"}</td></tr>
                <tr><th>⟨r⟩</th><td>{formatLength(orbital.mean_radius_pm, 5)}</td></tr>
                <tr><th>Nodes</th><td>{orbital.nodes.radial} radial, {orbital.nodes.angular} angular</td></tr>
                <tr><th>Reduced mass μ/mₑ</th><td>{orbital.reduced_mass_ratio.toFixed(8)}</td></tr>
              </tbody>
            </table>
          )}
        </section>

        {s.model === "scf" && (
          <section>
            <h3>Quantum calculation</h3>
            <div className="grid2">
              <label>
                Method
                <select value={s.scfMethod} onChange={(e) => set({ scfMethod: e.target.value as "HF" | "DFT" })}>
                  <option value="HF">Hartree–Fock</option>
                  <option value="DFT">DFT (Kohn–Sham)</option>
                </select>
              </label>
              {s.scfMethod === "DFT" && (
                <label>
                  Functional
                  <select value={s.scfXc} onChange={(e) => set({ scfXc: e.target.value })}>
                    {["LDA", "PBE", "B3LYP", "PBE0", "wB97X-D"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Basis set
                <select value={s.scfBasis} onChange={(e) => set({ scfBasis: e.target.value })}>
                  {["sto-3g", "6-31g", "6-31g*", "cc-pvdz", "cc-pvtz", "def2-svp", "def2-tzvp"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                2S (unpaired)
                <input
                  type="number"
                  min={0}
                  value={s.scfSpin ?? detail?.unpaired_electrons_hund ?? 0}
                  onChange={(e) => set({ scfSpin: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="row">
              <button className="primary" onClick={runSCF} disabled={job?.state === "running"}>
                Run calculation
              </button>
              {job?.state === "running" && <button onClick={() => api.cancelJob(job.id).then(setJob)}>Cancel</button>}
              {job && <span className="small muted">{job.state}{job.cached ? " (cached)" : ""} · {job.elapsed_s.toFixed(1)} s</span>}
            </div>
            {result && (
              <>
                <table className="props">
                  <tbody>
                    <tr><th>Total energy</th><td>{result.energy_Eh.toFixed(8)} Eh</td></tr>
                    <tr><th>Converged</th><td>{result.converged ? `yes, ${result.cycles.length} cycles` : "NO"}</td></tr>
                    <tr><th>Solver</th><td>{result.solver} · {result.n_basis_functions} basis functions</td></tr>
                    {result.s_squared !== null && <tr><th>⟨S²⟩</th><td>{result.s_squared.toFixed(4)}</td></tr>}
                    <tr><th>HOMO–LUMO gap</th><td>{result.homo_lumo_gap_eV?.toFixed(3) ?? "—"} eV</td></tr>
                    <tr><th>Grid electron count</th><td title="Riemann sum on the display grid; nuclear cusps are under-resolved">{result.grid.riemann_electron_count?.toFixed(2)} / {result.n_electrons}</td></tr>
                    <tr><th>Wall time</th><td>{result.wall_time_s.toFixed(2)} s</td></tr>
                  </tbody>
                </table>
                {result.warnings.map((w) => (
                  <div key={w} className="warn small">{w}</div>
                ))}
                <div className="grid2">
                  <label>
                    Show
                    <select value={s.scfView} onChange={(e) => set({ scfView: e.target.value as AtomicState["scfView"] })}>
                      <option value="density">Total density</option>
                      {result.volumes.spin_density && <option value="spin_density">Spin density</option>}
                      <option value="orbital">Selected orbital</option>
                      <option value="esp">Electrostatic potential</option>
                    </select>
                  </label>
                  {s.scfView === "esp" && (
                    <label>
                      Surface ρ (e/bohr³)
                      <input type="number" step={0.0005} min={0.0001} value={s.espSurfaceDensity} onChange={(e) => set({ espSurfaceDensity: Number(e.target.value) })} />
                    </label>
                  )}
                </div>
                <div className="muted small">Pick an orbital in the Energy levels tab below.</div>
              </>
            )}
          </section>
        )}

        <section>
          <h3>Display</h3>
          <div className="grid2">
            <label>
              Rendering
              <select value={s.mode} onChange={(e) => set({ mode: e.target.value as "volume" | "isosurface" })}>
                <option value="volume">Volumetric (transparent)</option>
                <option value="isosurface">Isosurface</option>
              </select>
            </label>
            <label>
              Grid points / edge
              <select value={s.points} onChange={(e) => set({ points: Number(e.target.value) })}>
                {[48, 64, 72, 96, 128].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Enclosed probability {(s.enclosedFraction * 100).toFixed(0)} %
            <input type="range" min={0.1} max={0.99} step={0.01} value={s.enclosedFraction} onChange={(e) => set({ enclosedFraction: Number(e.target.value) }, true)} />
          </label>
          <label>
            Opacity {s.opacity.toFixed(2)}
            <input type="range" min={0.05} max={s.mode === "volume" ? 5 : 1} step={0.05} value={s.opacity} onChange={(e) => set({ opacity: Number(e.target.value) }, true)} />
          </label>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={s.logScale} onChange={(e) => set({ logScale: e.target.checked })} /> log scale
            </label>
            {s.logScale && (
              <label className="check">
                decades
                <input type="number" min={1} max={8} value={s.logDecades} onChange={(e) => set({ logDecades: Number(e.target.value) })} style={{ width: 48 }} />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={s.showAxes} onChange={(e) => set({ showAxes: e.target.checked })} /> axes
            </label>
            <label className="check">
              <input type="checkbox" checked={s.orthographic} onChange={(e) => set({ orthographic: e.target.checked })} /> orthographic
            </label>
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={s.clipEnabled} onChange={(e) => set({ clipEnabled: e.target.checked })} /> clipping plane
            </label>
            <select value={s.clipAxis} onChange={(e) => set({ clipAxis: Number(e.target.value) as 0 | 1 | 2 })}>
              {AXES.map((a, i) => (
                <option key={a} value={i}>
                  ⟂ {a}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={s.clipFlip} onChange={(e) => set({ clipFlip: e.target.checked })} /> flip
            </label>
          </div>
          <label>
            Plane {AXES[s.clipAxis]} = {formatLength(s.clipOffsetPm)} (also used for the cross-section)
            <input
              type="range"
              min={-halfWidth}
              max={halfWidth}
              step={halfWidth / 100}
              value={s.clipOffsetPm}
              onChange={(e) => set({ clipOffsetPm: Number(e.target.value) }, true)}
            />
          </label>
          <button onClick={() => rendererRef.current?.resetView()}>Reset view</button>
        </section>

        {detail && (
          <section>
            <h3>Atomic properties</h3>
            <PropertyTable detail={detail} />
            <div className="muted small">Hover a row for method and source. Data: {Object.values(detail.sources).map((x) => `${x.name} (${x.license})`).join("; ")}.</div>
          </section>
        )}

        <section>
          <h3>Compare elements</h3>
          <select value={s.compare ?? ""} onChange={(e) => set({ compare: e.target.value || null })}>
            <option value="">— choose —</option>
            {elements.map((e) => (
              <option key={e.Z} value={e.symbol}>
                {e.Z} {e.symbol} {e.name}
              </option>
            ))}
          </select>
          {detail && compareDetail && <CompareTable a={detail} b={compareDetail} />}
        </section>
      </aside>

      {/* ---------------- bottom panel ---------------- */}
      <section className="bottom panel">
        <nav className="tabs">
          {[
            ["console", "Console"],
            ["radial", "Radial distribution"],
            ["levels", "Energy levels"],
            ["slice", "Cross-section & measure"],
            ["convergence", "SCF convergence"],
          ].map(([id, label]) => (
            <button key={id} className={bottomTab === id ? "active" : ""} onClick={() => setBottomTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="tab-body">
          {bottomTab === "console" && <Console entries={entries} onClear={clear} />}
          {bottomTab === "radial" &&
            (radial && orbital ? (
              <LineChart
                title={`Radial probability P(r) = r²R(r)² for ${orbital.label}`}
                series={[{ name: "P(r)", x: radial.r_pm, y: radial.P_per_pm }]}
                xLabel="r (pm)"
                yLabel="P(r) (pm⁻¹)"
                csvName={`radial-${orbital.label}`}
                markers={[
                  { x: radial.most_probable_radius_pm, label: `r_max ${radial.most_probable_radius_pm.toFixed(1)} pm`, color: "#9ad25a" },
                  { x: radial.mean_radius_pm, label: `⟨r⟩ ${radial.mean_radius_pm.toFixed(1)} pm`, color: "#f2a541" },
                  ...orbital.nodes.radial_node_radii_pm.map((r, i) => ({ x: r, label: `node ${i + 1}`, color: "#e5615e" })),
                ]}
              />
            ) : (
              <div className="muted">Radial distributions are shown for hydrogen-like orbitals.</div>
            ))}
          {bottomTab === "levels" &&
            (levels ? (
              <div className="two-col">
                <EnergyDiagram
                  title={`Hydrogen-like levels, Z = ${orbital?.Z}`}
                  levels={levels.levels.map((l) => ({ energy: l.energy_eV, label: `n=${l.n} (${l.degeneracy})`, highlight: l.n === s.n }))}
                />
                <div className="small">
                  <div>Ionization energy {levels.ionization_energy_eV.toFixed(6)} eV</div>
                  {detail?.properties.ionization_energies.available && (
                    <div className="muted">
                      Tabulated IE{s.charge + 1}: {(detail.properties.next_ionization_energy.value as number | null)?.toFixed(6) ?? "—"} eV ({provenance(detail.properties.next_ionization_energy)})
                    </div>
                  )}
                  <div className="muted">{levels.method}. {levels.limitations}</div>
                  <table className="props">
                    <tbody>
                      {levels.lines.slice(0, 10).map((l) => (
                        <tr key={`${l.series}${l.upper}`}>
                          <th>{l.series} {l.upper}→{l.lower}</th>
                          <td>{l.wavelength_nm.toFixed(3)} nm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : result ? (
              <div className="two-col">
                <EnergyDiagram
                  title={`${result.solver} orbital energies (−120 to 30 eV)`}
                  columns={result.orbitals.some((o) => o.spin === "beta") ? ["α", "β"] : ["orbitals"]}
                  levels={scfLevels}
                  onPick={(i) => {
                    const o = scfLevelSource[i];
                    set({ scfView: "orbital", scfOrbital: { spin: o.spin, index: o.index } });
                  }}
                />
                <div className="small muted">
                  Canonical {result.solver} orbital energies (Koopmans estimates for HF). Click a level to visualise that orbital. Core levels below −120 eV ({result.orbitals.filter((o) => o.energy_eV <= -120).length}) and virtual levels above 30 eV are omitted from the plot.
                </div>
              </div>
            ) : (
              <div className="muted">Energy levels appear for exact hydrogen-like systems or after an SCF calculation.</div>
            ))}
          {bottomTab === "slice" && (
            <SliceView field={field} axis={s.clipAxis} offsetPm={s.clipOffsetPm} logScale={s.logScale} logDecades={s.logDecades} />
          )}
          {bottomTab === "convergence" &&
            (result ? (
              <LineChart
                title="SCF convergence: |E − E_final|"
                series={[{ name: "ΔE", x: result.cycles.map((c) => c.cycle), y: result.cycles.map((c) => Math.log10(Math.max(Math.abs(c.energy_Eh - result.energy_Eh), 1e-14))) }]}
                xLabel="SCF cycle"
                yLabel="log₁₀ |ΔE| (Eh)"
                csvName="scf-convergence"
              />
            ) : (
              <div className="muted">Run an SCF calculation to see convergence.</div>
            ))}
        </div>
      </section>
    </div>
  );
}

function CompareTable({ a, b }: { a: ElementDetail; b: ElementDetail }) {
  const keys: [string, string][] = [
    ["atomic_mass", "Atomic mass"],
    ["electronegativity_pauling", "Electronegativity"],
    ["electron_affinity", "Electron affinity"],
    ["next_ionization_energy", "First ionization energy"],
    ["atomic_radius_empirical", "Atomic radius (empirical)"],
    ["van_der_waals_radius", "vdW radius"],
    ["valence_electrons", "Valence electrons"],
  ];
  const fmt = (d: ElementDetail, k: string) => {
    const p = d.properties[k];
    if (!p?.available) return "unavailable";
    return typeof p.value === "number" ? `${Number(p.value.toPrecision(6))}${p.unit ? ` ${p.unit}` : ""}` : String(p.value);
  };
  return (
    <table className="props compare">
      <thead>
        <tr>
          <th />
          <th>{a.summary.symbol}{a.charge ? ` (${a.charge > 0 ? "+" : ""}${a.charge})` : ""}</th>
          <th>{b.summary.symbol}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Configuration</th>
          <td>{a.configuration.text}</td>
          <td>{b.configuration.text}</td>
        </tr>
        {keys.map(([k, label]) => (
          <tr key={k}>
            <th>{label}</th>
            <td>{fmt(a, k)}</td>
            <td>{fmt(b, k)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Console({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [entries]);
  return (
    <div className="console" ref={ref}>
      <button className="small clear" onClick={onClear}>Clear</button>
      {entries.map((e, i) => (
        <div key={i} className={`log ${e.level}`}>
          <span className="muted">{e.time}</span> {e.message}
        </div>
      ))}
    </div>
  );
}

function dataURLtoBlob(url: string): Blob {
  const [head, data] = url.split(",");
  const mime = head.match(/:(.*?);/)?.[1] ?? "image/png";
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
