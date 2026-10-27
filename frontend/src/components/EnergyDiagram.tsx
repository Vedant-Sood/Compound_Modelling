// Energy-level diagrams with physical energy axes (eV).

import { niceTicks } from "./LineChart";

export interface Level {
  energy: number; // eV
  label: string;
  occupation?: number;
  column?: number; // 0 or 1 (e.g. alpha / beta)
  highlight?: boolean;
}

interface Props {
  levels: Level[];
  columns?: string[];
  title: string;
  onPick?: (i: number) => void;
}

export function EnergyDiagram({ levels, columns = [""], title, onPick }: Props) {
  if (!levels.length) return <div className="muted">No levels.</div>;
  const W = 420;
  const H = 260;
  const m = { l: 60, r: 10, t: 24, b: 20 };
  const es = levels.map((l) => l.energy);
  const lo = Math.min(...es);
  const hi = Math.max(0, ...es);
  const span = hi - lo || 1;
  const y = (e: number) => m.t + ((hi - e) / span) * (H - m.t - m.b);
  const colW = (W - m.l - m.r) / columns.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="energy">
      <style>{`text{fill:#aab4c3;font:10px system-ui,sans-serif}`}</style>
      <text x={m.l} y={14} style={{ fontWeight: 600 }}>
        {title}
      </text>
      {niceTicks(lo, hi, 6).map((t) => (
        <g key={t}>
          <line x1={m.l - 4} x2={m.l} y1={y(t)} y2={y(t)} stroke="#667" />
          <text x={m.l - 6} y={y(t) + 3} textAnchor="end">
            {Number(t.toPrecision(4))}
          </text>
        </g>
      ))}
      <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} stroke="#667" />
      <text transform={`translate(12 ${H / 2}) rotate(-90)`} textAnchor="middle">
        Energy (eV)
      </text>
      {columns.map((c, i) => (
        <text key={c} x={m.l + colW * (i + 0.5)} y={H - 4} textAnchor="middle">
          {c}
        </text>
      ))}
      {levels.map((l, i) => {
        const x0 = m.l + colW * (l.column ?? 0) + 10;
        const occ = l.occupation ?? 0;
        return (
          <g key={i} className="level" onClick={() => onPick?.(i)} style={{ cursor: onPick ? "pointer" : undefined }}>
            <title>{`${l.label}: ${l.energy.toFixed(4)} eV${l.occupation !== undefined ? `, occupation ${occ}` : ""}`}</title>
            <line
              x1={x0}
              x2={x0 + colW * 0.55}
              y1={y(l.energy)}
              y2={y(l.energy)}
              stroke={l.highlight ? "#f2a541" : occ > 0 ? "#5ec8e5" : "#55606f"}
              strokeWidth={l.highlight ? 3 : 2}
            />
            <text x={x0 + colW * 0.58} y={y(l.energy) + 3}>
              {l.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
