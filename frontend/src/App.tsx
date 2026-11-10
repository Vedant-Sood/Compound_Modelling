import { useCallback, useEffect, useState } from "react";
import { api, type ElementSummary } from "./api/client";
import { AtomicExplorer } from "./components/AtomicExplorer";
import { MolecularBuilder } from "./components/MolecularBuilder";
import { CrystalExplorer } from "./components/crystal/CrystalExplorer";
import { HelpDialog } from "./components/HelpDialog";

export const MODES = [
  { id: "atomic", label: "Atomic", phase: 1, available: true, blurb: "Elements, ions and isotopes; exact and SCF electron densities." },
  { id: "molecular", label: "Molecular", phase: 2, available: true, blurb: "Build molecules, optimise geometry, orbitals and ESP." },
  { id: "crystal", label: "Crystal", phase: 3, available: true, blurb: "Periodic lattices, symmetry, coordination and defects." },
  { id: "bonding", label: "Ionic / Bonding", phase: 3, available: false, blurb: "Charge transfer and bonding analysis between species." },
  { id: "alloys", label: "Alloys", phase: 4, available: false, blurb: "Composition design and ordering in metallic systems." },
  { id: "properties", label: "Properties", phase: 4, available: false, blurb: "Derived structural, thermodynamic and electronic properties." },
  { id: "simulations", label: "Simulations", phase: 5, available: false, blurb: "Molecular dynamics and time-dependent behaviour." },
] as const;

export type Mode = (typeof MODES)[number]["id"];
const LIVE = MODES.filter((m) => m.available);
const MODE_KEY = "chemmodel.mode";

function initialMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m && MODES.some((x) => x.id === m)) return m as Mode;
  } catch {
    /* storage unavailable */
  }
  return "atomic";
}

type Backend = { state: "connecting" } | { state: "online"; engines: Record<string, string | null> } | { state: "offline"; message: string };

export function App() {
  const [mode, setModeRaw] = useState<Mode>(initialMode);
  // Workspaces stay mounted once opened so switching modes keeps their state and running jobs.
  const [visited, setVisited] = useState<Set<Mode>>(() => new Set([initialMode()]));
  const [elements, setElements] = useState<ElementSummary[]>([]);
  const [backend, setBackend] = useState<Backend>({ state: "connecting" });
  const [help, setHelp] = useState(false);

  const setMode = useCallback((m: Mode) => {
    setModeRaw(m);
    setVisited((v) => (v.has(m) ? v : new Set(v).add(m)));
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const connect = useCallback(() => {
    setBackend({ state: "connecting" });
    Promise.all([api.elements(), api.health().catch(() => ({ engines: {} as Record<string, string | null> }))])
      .then(([r, h]) => {
        setElements(r.elements);
        setBackend({ state: "online", engines: h.engines });
      })
      .catch((e) => setBackend({ state: "offline", message: String(e.message ?? e) }));
  }, []);
  useEffect(connect, [connect]);

  // global shortcuts: 1-3 switch workspace, ? opens help, Esc closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") setHelp((h) => !h);
      else if (e.key === "Escape") setHelp(false);
      else if (/^[1-9]$/.test(e.key) && LIVE[Number(e.key) - 1]) {
        (document.activeElement as HTMLElement | null)?.blur();
        setMode(LIVE[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  const current = MODES.find((m) => m.id === mode)!;
  const engines = backend.state === "online" ? Object.entries(backend.engines) : [];
  const keep = (m: Mode) => visited.has(m) || mode === m;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="12" cy="12" r="2.4" fill="currentColor" />
            <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth="1.3" transform="rotate(60 12 12)" />
            <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth="1.3" transform="rotate(-60 12 12)" />
          </svg>
          <span>Chemical Modelling</span>
        </div>
        <nav className="modes" aria-label="Workspaces">
          {MODES.map((m) => {
            const n = LIVE.findIndex((x) => x.id === m.id) + 1;
            return (
              <button
                key={m.id}
                className={`${m.id === mode ? "active" : ""} ${m.available ? "" : "soon"}`}
                onClick={() => setMode(m.id)}
                title={m.available ? `${m.blurb} (${n})` : `Planned for phase ${m.phase}: ${m.blurb}`}
              >
                {m.label}
                {!m.available && <span className="soon-tag">soon</span>}
              </button>
            );
          })}
        </nav>
        <div className="toolbar-right">
          <BackendStatus backend={backend} engines={engines} onRetry={connect} />
          <button className="icon" title="Keyboard shortcuts and controls (?)" onClick={() => setHelp(true)} aria-label="Help">
            ?
          </button>
        </div>
      </header>
      {backend.state === "offline" && (
        <div className="error banner">
          <span>Cannot reach the scientific backend ({backend.message}). Start it with <code>scripts/start</code> (see README), then retry.</span>
          <button onClick={connect}>Retry</button>
        </div>
      )}

      <div className="workspaces">
        {keep("atomic") && (
          <div className={`ws-slot ${mode === "atomic" ? "" : "hidden"}`}>
            {elements.length > 0 ? (
              <AtomicExplorer elements={elements} active={mode === "atomic"} />
            ) : (
              <div className="loading-state">
                {backend.state === "offline" ? "Atomic Explorer needs the backend for element data." : <><span className="spinner" /> Loading element data…</>}
              </div>
            )}
          </div>
        )}
        {keep("molecular") && (
          <div className={`ws-slot ${mode === "molecular" ? "" : "hidden"}`}>
            <MolecularBuilder active={mode === "molecular"} />
          </div>
        )}
        {keep("crystal") && (
          <div className={`ws-slot ${mode === "crystal" ? "" : "hidden"}`}>
            <CrystalExplorer active={mode === "crystal"} />
          </div>
        )}
        {!current.available && (
          <div className="ws-slot">
            <div className="placeholder">
              <h2>{current.label}</h2>
              <p>
                {current.blurb} This workspace is scheduled for development phase {current.phase}. It is not available yet, and no
                results are simulated in its place. See docs/ROADMAP.md for status.
              </p>
              <h3>Available now</h3>
              <div className="mode-cards">
                {LIVE.map((m, i) => (
                  <button key={m.id} className="mode-card" onClick={() => setMode(m.id)}>
                    <span className="mode-card-title">{m.label}</span>
                    <span className="muted small">{m.blurb}</span>
                    <kbd>{i + 1}</kbd>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {help && <HelpDialog mode={mode} onClose={() => setHelp(false)} />}
    </div>
  );
}

function BackendStatus({ backend, engines, onRetry }: { backend: Backend; engines: [string, string | null][]; onRetry: () => void }) {
  const label = backend.state === "online" ? "Backend connected" : backend.state === "offline" ? "Backend offline" : "Connecting…";
  const detail =
    backend.state === "online"
      ? `Scientific engines detected:\n${engines.map(([k, v]) => `${k.replace(".core", "")}: ${v ?? "not installed"}`).join("\n")}`
      : backend.state === "offline"
        ? `${backend.message}\nClick to retry.`
        : "Contacting the backend…";
  return (
    <button className={`status-pill ${backend.state}`} title={detail} onClick={backend.state === "offline" ? onRetry : undefined}>
      <span className="dot" />
      {label}
      {backend.state === "online" && (
        <span className="muted engines">
          {engines.filter(([, v]) => v).length}/{engines.length} engines
        </span>
      )}
    </button>
  );
}
