import { useRef } from "react";

export interface Series {
  name: string;
  x: number[];
  y: number[];
  color?: string;
}

export interface Marker {
  x: number;
  label: string;
  color?: string;
}

interface Props {
  series: Series[];
  xLabel: string;
  yLabel: string;
  markers?: Marker[];
  height?: number;
  title?: string;
  csvName?: string;
}

const PALETTE = ["#5ec8e5", "#f2a541", "#e5615e", "#9ad25a", "#b38cf2"];

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [lo];
  const step0 = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= step0) ?? step0;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1);
  return Number(v.toPrecision(4)).toString();
};

export function toCSV(series: Series[], xLabel: string, yLabel: string): string {
  const rows = [`series,${xLabel},${yLabel}`];
  for (const s of series) s.x.forEach((x, i) => rows.push(`${s.name},${x},${s.y[i]}`));
  return rows.join("\n");
}

export function download(name: string, content: string | Blob, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function LineChart({ series, xLabel, yLabel, markers = [], height = 220, title, csvName }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 560;
  const H = height;
  const m = { l: 62, r: 14, t: title ? 22 : 10, b: 38 };
  const xs = series.flatMap((s) => s.x);
  const ys = series.flatMap((s) => s.y);
  if (!xs.length) return <div className="muted">No data.</div>;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(0, ...ys);
  let y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  const pad = 0.05 * (y1 - y0);
  y1 += pad;
  if (y0 < 0) y0 -= pad;
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);

  const exportPNG = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W * 4;
      c.height = H * 4;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#11151d";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && download(`${csvName ?? "plot"}.png`, b));
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  };

  return (
    <div className="chart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg">
        <style>{`text{fill:#aab4c3;font:11px system-ui,sans-serif}`}</style>
        {title && (
          <text x={m.l} y={14} style={{ fontWeight: 600 }}>
            {title}
          </text>
        )}
        {niceTicks(x0, x1).map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} stroke="#232a36" />
            <text x={sx(t)} y={H - m.b + 14} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        {niceTicks(y0, y1).map((t) => (
          <g key={`y${t}`}>
            <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} stroke="#232a36" />
            <text x={m.l - 6} y={sy(t) + 4} textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} stroke="#3a4352" />
        {markers.map((mk) => (
          <g key={mk.label}>
            <line x1={sx(mk.x)} x2={sx(mk.x)} y1={m.t} y2={H - m.b} stroke={mk.color ?? "#888"} strokeDasharray="4 3" />
            <text x={sx(mk.x) + 4} y={m.t + 12} style={{ fill: mk.color ?? "#888" }}>
              {mk.label}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color ?? PALETTE[i % PALETTE.length]}
            strokeWidth={1.8}
            points={s.x.map((x, j) => `${sx(x).toFixed(1)},${sy(s.y[j]).toFixed(1)}`).join(" ")}
          />
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">
          {xLabel}
        </text>
        <text transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          {yLabel}
        </text>
        {series.length > 1 &&
          series.map((s, i) => (
            <text key={`l${s.name}`} x={W - m.r - 4} y={m.t + 14 + i * 14} textAnchor="end" style={{ fill: s.color ?? PALETTE[i % PALETTE.length] }}>
              {s.name}
            </text>
          ))}
      </svg>
      <div className="chart-actions">
        <button onClick={() => download(`${csvName ?? "plot"}.csv`, toCSV(series, xLabel, yLabel), "text/csv")}>CSV</button>
        <button onClick={exportPNG}>PNG ×4</button>
      </div>
    </div>
  );
}
