import { useEffect, useState } from "react";
import { api, type ElementSummary } from "./api/client";
import { AtomicExplorer } from "./components/AtomicExplorer";

const MODES = [
  { id: "atomic", label: "Atomic", phase: 1 },
  { id: "molecular", label: "Molecular", phase: 2 },
  { id: "bonding", label: "Ionic / Bonding", phase: 3 },
  { id: "crystal", label: "Crystal", phase: 3 },
  { id: "alloys", label: "Alloys", phase: 4 },
  { id: "simulations", label: "Simulations", phase: 5 },
  { id: "properties", label: "Properties", phase: 4 },
] as const;

type Mode = (typeof MODES)[number]["id"];

export function App() {
  const [mode, setMode] = useState<Mode>("atomic");
  const [elements, setElements] = useState<ElementSummary[]>([]);
  const [health, setHealth] = useState<Record<string, string | null> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .elements()
      .then((r) => setElements(r.elements))
      .catch((e) => setError(`Cannot reach the scientific backend (${e.message}). Start it with scripts/start (see README).`));
    api.health().then((h) => setHealth(h.engines)).catch(() => undefined);
  }, []);

  const current = MODES.find((m) => m.id === mode)!;
  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">Chemical Modelling</div>
        <nav>
          {MODES.map((m) => (
            <button key={m.id} className={m.id === mode ? "active" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
        <div className="engines small muted" title="Scientific engines detected by the backend">
          {health &&
            Object.entries(health)
              .map(([k, v]) => `${k.replace(".core", "")} ${v ? "✓" : "✗"}`)
              .join(" · ")}
        </div>
      </header>
      {error && <div className="error banner">{error}</div>}
      {mode === "atomic" ? (
        elements.length > 0 && <AtomicExplorer elements={elements} />
      ) : (
        <div className="placeholder">
          <h2>{current.label} workspace</h2>
          <p>
            Scheduled for development phase {current.phase}. It is not available yet, and no results are simulated in its
            place. See docs/ROADMAP.md for status.
          </p>
        </div>
      )}
    </div>
  );
}
