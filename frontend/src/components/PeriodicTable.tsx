import type { ElementSummary } from "../api/client";

interface Props {
  elements: ElementSummary[];
  selected: string;
  compare?: string | null;
  onSelect: (symbol: string) => void;
}

const SERIES_COLOURS: Record<string, string> = {
  "Alkali metals": "#c0564b",
  "Alkaline earth metals": "#c98a3c",
  "Transition metals": "#b9a24a",
  "Poor metals": "#6f9a5b",
  Metalloids: "#4f9a8f",
  Nonmetals: "#4b86b5",
  Halogens: "#6a6fc0",
  "Noble gases": "#8a5fb5",
  Lanthanides: "#b25f93",
  Actinides: "#a2506a",
};

/** Grid position: lanthanides/actinides go to rows 9-10 (the f-block strip). */
function position(e: ElementSummary): [number, number] {
  if (e.Z >= 57 && e.Z <= 71) return [9, 3 + (e.Z - 57)];
  if (e.Z >= 89 && e.Z <= 103) return [10, 3 + (e.Z - 89)];
  return [e.period, e.group];
}

export function PeriodicTable({ elements, selected, compare, onSelect }: Props) {
  return (
    <div className="ptable" role="grid" aria-label="Periodic table">
      {elements.map((e) => {
        const [row, col] = position(e);
        const cls = ["pt-cell", e.symbol === selected ? "sel" : "", e.symbol === compare ? "cmp" : ""].join(" ");
        return (
          <button
            key={e.Z}
            className={cls}
            style={{
              gridRow: row,
              gridColumn: col,
              background: SERIES_COLOURS[e.series] ?? "#555",
            }}
            title={`${e.Z} ${e.name} (${e.series})`}
            onClick={() => onSelect(e.symbol)}
          >
            <span className="pt-z">{e.Z}</span>
            <span className="pt-sym">{e.symbol}</span>
          </button>
        );
      })}
      <div className="pt-gap" style={{ gridRow: 8, gridColumn: "1 / span 18" }} />
    </div>
  );
}
