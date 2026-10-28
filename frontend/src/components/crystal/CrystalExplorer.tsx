// MODE D - Crystal Explorer: periodic structures with many atoms in the cell,
// space-group symmetry, coordination, supercells, Miller planes and defects.

import * as THREE from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crystalApi, type CrystalReport, type DisplayGeometry, type ExampleInfo, type SiteInfo } from "../../api/crystal";
import { molApi, type DisplayData } from "../../api/molecular";
import { CellOverlay } from "../../render/CellOverlay";
import { StructureLayer } from "../../render/StructureLayer";
import { VolumeRenderer, type ViewInfo } from "../../render/VolumeRenderer";
import { formulaFromComposition, fracToCart, parseBasis, type Vec3 } from "../../science/crystal";
import { niceScaleBar } from "../../science/units";
import { Console, dataURLtoBlob } from "../common";
import { download } from "../LineChart";
import { Splitter } from "../Splitter";
import { useLog } from "../useLog";
import "./crystal.css";

const DEFAULT_EXAMPLE = "NaCl (rock salt)";
const fmt = (x: number | null | undefined, d = 4) => (x === null || x === undefined ? "—" : x.toFixed(d));

export function CrystalExplorer() {
  const { log, entries, clear } = useLog();
  const [examples, setExamples] = useState<Record<string, ExampleInfo>>({});
  const [display, setDisplay] = useState<DisplayData | null>(null);
  const [report, setReport] = useState<CrystalReport | null>(null);
  const [past, setPast] = useState<CrystalReport[]>([]);
  const [geom, setGeom] = useState<DisplayGeometry | null>(null);
  const [repeats, setRepeats] = useState<Vec3>([1, 1, 1]);
  const [boundary, setBoundary] = useState(true);
  const [showBonds, setShowBonds] = useState(true);
  const [radiusScale, setRadiusScale] = useState(0.4);
  const [selected, setSelected] = useState<number[]>([]);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [hkl, setHkl] = useState<Vec3>([1, 1, 1]);
  const [showPlane, setShowPlane] = useState(false);
  const [plane, setPlane] = useState<{ d_spacing_angstrom: number } | null>(null);
  const [cellpar, setCellpar] = useState<number[]>([]);
  const [custom, setCustom] = useState({ spacegroup: "225", cellpar: "4.05 4.05 4.05 90 90 90", basis: "Al 0 0 0" });
  const [superN, setSuperN] = useState<Vec3>([2, 2, 2]);
  const [subSpecies, setSubSpecies] = useState("K");
  const [interFrac, setInterFrac] = useState("0.5 0.5 0.5");
  const [interSpecies, setInterSpecies] = useState("H");
  const [vi, setVi] = useState<ViewInfo | null>(null);
  const [busy, setBusy] = useState(false);
  // Derived cells (supercell, primitive, ...) inherit whether their parent was hypothetical.
  const [hypothetical, setHypothetical] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VolumeRenderer | null>(null);
  const layerRef = useRef<StructureLayer | null>(null);
  const cellRef = useRef<CellOverlay | null>(null);
  const downAt = useRef<[number, number] | null>(null);

  // ---- setup ------------------------------------------------------------------
  useEffect(() => {
    const r = new VolumeRenderer(viewportRef.current!);
    const layer = new StructureLayer();
    const cell = new CellOverlay();
    r.solids.add(layer.group);
    r.solids.add(cell.group);
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
    cellRef.current = cell;
    return () => r.dispose();
  }, []);

  const hypRef = useRef(false);
  const accept = useCallback(
    (incoming: CrystalReport, note: string, keepHistory = true) => {
      const r = { ...incoming, hypothetical: incoming.hypothetical ?? hypRef.current };
      hypRef.current = r.hypothetical;
      setHypothetical(r.hypothetical);
      setReport((prev) => {
        if (prev && keepHistory) setPast((p) => [...p.slice(-29), prev]);
        return r;
      });
      setSelected([]);
      setSite(null);
      const l = r.lattice;
      setCellpar([l.a, l.b, l.c, l.alpha, l.beta, l.gamma]);
      const sym = r.symmetry.error ? `symmetry undetermined (${r.symmetry.error})` : `${r.symmetry.international} (No. ${r.symmetry.number})`;
      log(`${note}: ${formulaFromComposition(r.composition)}, ${r.n_atoms} atoms in cell, ${sym}`);
      if (r.provenance) log(`Source: ${r.provenance}`);
    },
    [log],
  );

  const run = useCallback(
    async (what: string, f: () => Promise<CrystalReport>, keepHistory = true) => {
      setBusy(true);
      try {
        accept(await f(), what, keepHistory);
      } catch (e) {
        log(`${what} failed: ${(e as Error).message}`, "error");
      } finally {
        setBusy(false);
      }
    },
    [accept, log],
  );

  useEffect(() => {
    molApi.displayData().then(setDisplay).catch((e) => log(`display data: ${e.message}`, "error"));
    crystalApi
      .examples()
      .then((r) => setExamples(r.examples))
      .catch((e) => log(`examples: ${e.message}`, "error"));
    run(`Loaded ${DEFAULT_EXAMPLE}`, () => crystalApi.build({ name: DEFAULT_EXAMPLE }), false);
  }, [log, run]);

  // ---- display geometry (all drawn atoms, bonds, cell) ---------------------------------
  useEffect(() => {
    if (!report) return;
    let live = true;
    crystalApi
      .display(report.structure, repeats, boundary)
      .then((g) => {
        if (!live) return;
        setGeom(g);
        setSelected([]);
        setSite(null);
      })
      .catch((e) => live && log(`Display failed: ${e.message}`, "error"));
    return () => {
      live = false;
    };
  }, [report, repeats, boundary, log]);

  // frame the camera whenever the drawn region changes
  useEffect(() => {
    if (!geom) return;
    const centre = new THREE.Vector3(...fracToCart([repeats[0] / 2, repeats[1] / 2, repeats[2] / 2], geom.cell));
    const corner = new THREE.Vector3(...fracToCart(repeats, geom.cell));
    rendererRef.current?.frameView(centre.clone().multiplyScalar(100), (corner.length() / 2 + 1.5) * 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom?.cell, repeats]);

  // neighbours of the last selected atom among the drawn atoms (first shell)
  const neighbours = useMemo(() => {
    const k = selected.at(-1);
    if (k === undefined || !geom) return [];
    return geom.bonds.filter((b) => b.i === k || b.j === k).map((b) => (b.i === k ? b.j : b.i));
  }, [selected, geom]);

  // redraw
  useEffect(() => {
    if (!geom || !display || !layerRef.current) return;
    layerRef.current.set(geom.atoms, showBonds ? geom.bonds : [], { radiusScale, covalent: display.covalent_radius_angstrom, colour: display.colour }, selected, neighbours);
    cellRef.current?.set(geom.cell, repeats, showPlane ? hkl : null);
    rendererRef.current?.requestRender();
  }, [geom, display, showBonds, radiusScale, selected, neighbours, repeats, showPlane, hkl]);

  useEffect(() => {
    if (!report || !showPlane) return setPlane(null);
    crystalApi.plane(report.structure, hkl).then(setPlane).catch((e) => log(`Plane: ${e.message}`, "error"));
  }, [report, hkl, showPlane, log]);

  // ---- picking -------------------------------------------------------------------------
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = downAt.current;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4) return;
    const r = rendererRef.current;
    const layer = layerRef.current;
    if (!r || !layer?.atomsMesh || !geom || !report) return;
    const idx = r.pick(e.clientX, e.clientY, [layer.atomsMesh])[0]?.instanceId;
    if (idx === undefined) {
      setSelected([]);
      setSite(null);
      return;
    }
    setSelected((s) => (s.includes(idx) ? s.filter((x) => x !== idx) : [...s, idx].slice(-2)));
    crystalApi
      .site(report.structure, geom.atoms[idx].site)
      .then(setSite)
      .catch((err) => log(`Site analysis failed: ${err.message}`, "error"));
  };

  const measurement = useMemo(() => {
    if (!geom || selected.length !== 2) return null;
    const [a, b] = selected.map((k) => new THREE.Vector3(...geom.atoms[k].xyz));
    return `${geom.atoms[selected[0]].symbol}${selected[0]} – ${geom.atoms[selected[1]].symbol}${selected[1]}: ${a.distanceTo(b).toFixed(4)} Å`;
  }, [geom, selected]);

  const selectedSite = selected.length && geom ? geom.atoms[selected.at(-1)!].site : null;

  // ---- actions -------------------------------------------------------------------------
  const loadExample = (name: string) => run(`Loaded ${name}`, () => crystalApi.build({ name }));
  const applyCellpar = () =>
    report &&
    run("Lattice parameters changed (fractional coordinates kept)", () =>
      crystalApi.build({ cellpar, species: report.structure.species, frac_coords: report.structure.frac_coords }),
    );
  const buildCustom = () =>
    run("Built custom crystal", async () => {
      const cp = custom.cellpar.trim().split(/[\s,]+/).map(Number);
      const { species, frac } = parseBasis(custom.basis);
      const sg = custom.spacegroup.trim() ? Number(custom.spacegroup) : null;
      return crystalApi.build({ cellpar: cp, species, frac_coords: frac, spacegroup: sg });
    });
  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    accept(prev, "Undo", false);
  };

  const saveJSON = () =>
    report &&
    download(
      `crystal-${formulaFromComposition(report.composition)}.json`,
      JSON.stringify({ application: "Chemical Modelling", workspace: "crystal", format_version: 1, saved_at: new Date().toISOString(), structure: report.structure, provenance: report.provenance ?? null, hypothetical }, null, 2),
      "application/json",
    );
  const exportXYZ = () => {
    if (!report) return;
    const s = report.structure;
    const lat = s.cell.flat().map((x) => x.toFixed(8)).join(" ");
    const lines = s.species.map((sp, k) => `${sp} ${fracToCart(s.frac_coords[k] as Vec3, s.cell).map((x) => x.toFixed(8)).join(" ")}`);
    download(`crystal-${formulaFromComposition(report.composition)}.xyz`, `${s.species.length}\nLattice="${lat}" Properties=species:S:1:pos:R:3 pbc="T T T"\n${lines.join("\n")}\n`);
  };
  const open = (file: File) =>
    file
      .text()
      .then((t) => {
        const d = JSON.parse(t);
        if (!d.structure) throw new Error("not a Chemical Modelling crystal file");
        return run(`Opened ${file.name}`, async () => ({ ...(await crystalApi.analyse(d.structure)), provenance: d.provenance ?? `Opened from ${file.name}`, hypothetical: d.hypothetical ?? true }));
      })
      .catch((e) => log(`Open failed: ${e.message}`, "error"));

  // unique sites by symmetry equivalence
  const uniqueSites = useMemo(() => {
    if (!report || report.symmetry.error) return [];
    const seen = new Map<number, { w: (typeof report.symmetry.wyckoff)[number]; count: number }>();
    for (const w of report.symmetry.wyckoff) {
      const e = seen.get(w.equivalent_to);
      if (e) e.count++;
      else seen.set(w.equivalent_to, { w, count: 1 });
    }
    return [...seen.values()];
  }, [report]);

  const angleSummary = useMemo(() => {
    if (!site) return "";
    const counts = new Map<string, number>();
    site.bond_angles_deg.forEach((a) => counts.set(a.toFixed(2), (counts.get(a.toFixed(2)) ?? 0) + 1));
    return [...counts.entries()].map(([a, n]) => `${a}° ×${n}`).join(", ");
  }, [site]);

  const scaleBar = vi ? niceScaleBar(vi.pmPerPx) : null;

  return (
    <div className="workspace crystal">
      <aside className="left panel">
        <h3>Structure</h3>
        <select value="" onChange={(e) => e.target.value && loadExample(e.target.value)}>
          <option value="">Reference crystals…</option>
          {Object.entries(examples).map(([k, v]) => (
            <option key={k} value={k}>
              {k} · {v.kind}
            </option>
          ))}
        </select>
        <div className="row">
          <button onClick={undo} disabled={!past.length}>Undo</button>
          {busy && <span className="muted small">working…</span>}
        </div>

        <h3>Lattice parameters</h3>
        <div className="grid3">
          {["a (Å)", "b (Å)", "c (Å)", "α (°)", "β (°)", "γ (°)"].map((label, k) => (
            <label key={label}>
              {label}
              <input type="number" step={k < 3 ? 0.01 : 0.5} value={cellpar[k] !== undefined ? +cellpar[k].toFixed(5) : ""} onChange={(e) => setCellpar((c) => c.map((x, i) => (i === k ? Number(e.target.value) : x)))} />
            </label>
          ))}
        </div>
        <button onClick={applyCellpar} disabled={!report}>Apply (hypothetical)</button>

        <details>
          <summary className="small">Custom crystal (space group + basis)</summary>
          <label>
            Space group number (1–230, blank = P1)
            <input value={custom.spacegroup} onChange={(e) => setCustom({ ...custom, spacegroup: e.target.value })} />
          </label>
          <label>
            a b c α β γ
            <input value={custom.cellpar} onChange={(e) => setCustom({ ...custom, cellpar: e.target.value })} />
          </label>
          <label>
            Basis: symbol and fractional x y z per line
            <textarea rows={4} value={custom.basis} onChange={(e) => setCustom({ ...custom, basis: e.target.value })} />
          </label>
          <button onClick={buildCustom}>Build</button>
        </details>

        <h3>Cell</h3>
        <div className="row">
          <button disabled={!report} onClick={() => report && run("Primitive cell (spglib)", () => crystalApi.standardise(report.structure, "primitive"))}>Primitive</button>
          <button disabled={!report} onClick={() => report && run("Conventional cell (spglib)", () => crystalApi.standardise(report.structure, "conventional"))}>Conventional</button>
        </div>
        <div className="row">
          {superN.map((n, k) => (
            <input key={k} className="n" type="number" min={1} max={8} value={n} onChange={(e) => setSuperN((s) => s.map((x, i) => (i === k ? Math.max(1, Number(e.target.value)) : x)) as Vec3)} />
          ))}
          <button disabled={!report} onClick={() => report && run(`Supercell ${superN.join("×")}`, () => crystalApi.supercell(report.structure, superN))}>Make supercell</button>
        </div>
        <div className="muted small">A supercell becomes the new cell (for defects). To only look at more cells, use “Show cells” below.</div>

        <h3>View</h3>
        <label>
          Show cells (n₁ n₂ n₃)
          <div className="row">
            {repeats.map((n, k) => (
              <input key={k} className="n" type="number" min={1} max={6} value={n} onChange={(e) => setRepeats((s) => s.map((x, i) => (i === k ? Math.min(6, Math.max(1, Number(e.target.value))) : x)) as Vec3)} />
            ))}
          </div>
        </label>
        <label className="check"><input type="checkbox" checked={boundary} onChange={(e) => setBoundary(e.target.checked)} /> boundary images (atoms on faces, edges and corners)</label>
        <label className="check"><input type="checkbox" checked={showBonds} onChange={(e) => setShowBonds(e.target.checked)} /> bonds to first-shell neighbours</label>
        <label>
          Sphere size {radiusScale.toFixed(2)} × covalent radius
          <input type="range" min={0.15} max={1} step={0.05} value={radiusScale} onChange={(e) => setRadiusScale(Number(e.target.value))} />
        </label>
        <label className="check"><input type="checkbox" checked={showPlane} onChange={(e) => setShowPlane(e.target.checked)} /> Miller planes (h k l)</label>
        <div className="row">
          {hkl.map((n, k) => (
            <input key={k} className="n" type="number" min={-6} max={6} value={n} onChange={(e) => setHkl((s) => s.map((x, i) => (i === k ? Number(e.target.value) : x)) as Vec3)} />
          ))}
          {plane && <span className="small">d = {plane.d_spacing_angstrom.toFixed(4)} Å</span>}
        </div>

        <h3>File</h3>
        <div className="row">
          <button disabled={!report} onClick={saveJSON}>Save</button>
          <label className="button">
            Open
            <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
          </label>
          <button disabled={!report} onClick={exportXYZ}>Extended XYZ</button>
          <button onClick={() => rendererRef.current && download("crystal.png", dataURLtoBlob(rendererRef.current.exportPNG(3)))}>Image ×3</button>
        </div>
      </aside>

      <Splitter variable="--left" direction={1} min={220} max={560} />
      <Splitter variable="--right" direction={-1} min={280} max={640} />
      <Splitter variable="--bottom" direction={-1} vertical min={120} max={600} />

      <main className="viewport-wrap" onPointerDown={(e) => (downAt.current = [e.clientX, e.clientY])} onClick={onClick}>
        <div className="viewport" ref={viewportRef} />
        <div className="overlay top-left">
          {report && (
            <div className={`badge ${hypothetical ? "approx" : "exact"}`}>
              {hypothetical ? "Hypothetical structure (not experimental, not relaxed)" : "Experimental lattice parameters"}
            </div>
          )}
          {report && (
            <div className="field-title">
              {formulaFromComposition(report.composition)} · {report.symmetry.error ? "symmetry undetermined" : `${report.symmetry.international} (${report.symmetry.number})`} · {report.n_atoms} atoms per cell
              {geom && ` · ${geom.atoms.length} drawn`}
            </div>
          )}
          {measurement && <div className="field-title">{measurement}</div>}
          <div className="small muted">Click an atom to see its coordination shell (cyan); click a second atom to measure the distance.</div>
        </div>
        <div className="overlay bottom-left">
          {scaleBar && (
            <div className="scalebar">
              <div className="bar" style={{ width: scaleBar.px }} />
              <span>{scaleBar.label}</span>
            </div>
          )}
          <div className="small muted">Spheres: {radiusScale.toFixed(2)} × covalent radius (display only). Lines: unit cell{repeats.some((n) => n > 1) ? " (dim) and shown region" : ""}.</div>
        </div>
      </main>

      <aside className="right panel">
        {report && (
          <>
            <h3>Properties</h3>
            <table className="props">
              <tbody>
                <tr><th>Formula (cell)</th><td>{Object.entries(report.composition).map(([s, n]) => `${s}${n}`).join(" ")}</td></tr>
                <tr><th>a, b, c</th><td>{fmt(report.lattice.a)}, {fmt(report.lattice.b)}, {fmt(report.lattice.c)} Å</td></tr>
                <tr><th>α, β, γ</th><td>{fmt(report.lattice.alpha, 2)}°, {fmt(report.lattice.beta, 2)}°, {fmt(report.lattice.gamma, 2)}°</td></tr>
                <tr><th>Volume</th><td>{fmt(report.lattice.volume_angstrom3, 3)} Å³</td></tr>
                <tr><th>Density</th><td title={report.density_g_cm3.method}>{fmt(report.density_g_cm3.value, 3)} g/cm³</td></tr>
                {!report.symmetry.error && (
                  <>
                    <tr><th>Space group</th><td>{report.symmetry.international} (No. {report.symmetry.number})</td></tr>
                    <tr><th>Crystal system</th><td>{report.symmetry.crystal_system}, centring {report.symmetry.bravais_centring}</td></tr>
                    <tr><th>Point group</th><td>{report.symmetry.point_group} · {report.symmetry.n_operations} operations</td></tr>
                  </>
                )}
              </tbody>
            </table>
            <div className="muted small">
              Symmetry: {report.symmetry.error ?? `${report.symmetry.engine}, tolerance ${report.symmetry.symprec_angstrom} Å`}. Density from cell contents and volume.
              {report.provenance && <> Source: {report.provenance}</>}
            </div>

            <h3>Sites and coordination</h3>
            <table className="props sites">
              <thead>
                <tr><th>Site</th><th>Wyckoff</th><th>×</th><th>CN</th><th>Neighbours</th><th>d (Å)</th></tr>
              </thead>
              <tbody>
                {(uniqueSites.length ? uniqueSites : report.coordination.map((c) => ({ w: { index: c.index, species: c.species, letter: "?", site_symmetry: "", equivalent_to: c.index }, count: 1 }))).map(({ w, count }) => {
                  const c = report.coordination[w.index];
                  return (
                    <tr key={w.index}>
                      <td>{w.species}{w.index}</td>
                      <td>{w.letter} {w.site_symmetry}</td>
                      <td>{count}</td>
                      <td>{c.cn}</td>
                      <td>{Object.entries(c.neighbours).map(([s, n]) => `${n} ${s}`).join(", ")}</td>
                      <td>{fmt(c.nearest_angstrom, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="muted small">{report.coordination_method}.</div>

            {site && selectedSite !== null && (
              <>
                <h3>Selected site {site.species}{site.index}</h3>
                <table className="props">
                  <tbody>
                    <tr><th>Fractional</th><td>{site.frac.map((x) => x.toFixed(4)).join(", ")}</td></tr>
                    <tr><th>Coordination</th><td>{site.coordination.cn} ({Object.entries(site.coordination.neighbours).map(([s, n]) => `${n} ${s}`).join(", ")})</td></tr>
                    <tr><th>Nearest</th><td>{fmt(site.coordination.nearest_angstrom)} Å</td></tr>
                    <tr><th>Next shell</th><td>{fmt(site.coordination.second_shell_angstrom)} Å</td></tr>
                    <tr><th>Shell angles</th><td>{angleSummary || "—"}</td></tr>
                  </tbody>
                </table>
              </>
            )}

            <h3>Defects (hypothetical, unrelaxed)</h3>
            <div className="row">
              <button disabled={selectedSite === null} onClick={() => report && selectedSite !== null && run(`Vacancy at site ${selectedSite}`, () => crystalApi.defect(report.structure, { kind: "vacancy", index: selectedSite }))}>
                Vacancy at selected
              </button>
            </div>
            <div className="row">
              <input className="sym" value={subSpecies} onChange={(e) => setSubSpecies(e.target.value)} />
              <button disabled={selectedSite === null} onClick={() => report && selectedSite !== null && run(`Substitution ${subSpecies} at site ${selectedSite}`, () => crystalApi.defect(report.structure, { kind: "substitution", index: selectedSite, species: subSpecies }))}>
                Substitute selected
              </button>
            </div>
            <div className="row">
              <input className="sym" value={interSpecies} onChange={(e) => setInterSpecies(e.target.value)} />
              <input style={{ width: 110 }} value={interFrac} onChange={(e) => setInterFrac(e.target.value)} title="fractional x y z" />
              <button
                onClick={() =>
                  report &&
                  run(`Interstitial ${interSpecies} at ${interFrac}`, () => crystalApi.defect(report.structure, { kind: "interstitial", species: interSpecies, frac: interFrac.trim().split(/[\s,]+/).map(Number) }))
                }
              >
                Add interstitial
              </button>
            </div>
            <div className="muted small">Select an atom first. For a dilute defect, make a supercell before adding it.</div>
          </>
        )}
      </aside>

      <section className="bottom panel">
        <nav className="tabs">
          <button className="active">Console</button>
        </nav>
        <div className="tab-body">
          <Console entries={entries} onClear={clear} />
        </div>
      </section>
    </div>
  );
}
