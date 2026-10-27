// Cross-section through the current volume with distance/angle measurement.
// Coordinates come straight from the calculation grid (pm).

import { useEffect, useMemo, useRef, useState } from "react";
import type { VolumeField } from "../render/VolumeRenderer";
import { formatLength } from "../science/units";

interface Props {
  field: VolumeField | null;
  axis: 0 | 1 | 2;
  offsetPm: number;
  logScale: boolean;
  logDecades: number;
}

const AXES = ["x", "y", "z"];

type Pt = [number, number]; // in-plane coordinates (pm)

export function measure(points: Pt[]): { distances: number[]; angleDeg: number | null } {
  const distances = [];
  for (let i = 1; i < points.length; i++)
    distances.push(Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  let angleDeg = null;
  if (points.length === 3) {
    const [a, b, c] = points;
    const u = [a[0] - b[0], a[1] - b[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
    angleDeg = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  }
  return { distances, angleDeg };
}

export function SliceView({ field, axis, offsetPm, logScale, logDecades }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const plane = useMemo(() => {
    if (!field) return null;
    const [nx, ny, nz] = field.shape;
    const n = [nx, ny, nz];
    const k = Math.round((offsetPm - field.originPm[axis]) / field.spacingPm);
    const kc = Math.min(Math.max(k, 0), n[axis] - 1);
    const [ua, va] = [0, 1, 2].filter((a) => a !== axis);
    const W = n[ua];
    const H = n[va];
    const vals = new Float32Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const idx = [0, 0, 0];
        idx[axis] = kc;
        idx[ua] = i;
        idx[va] = j;
        vals[j * W + i] = field.values[idx[0] + nx * (idx[1] + ny * idx[2])];
      }
    return {
      vals,
      W,
      H,
      ua,
      va,
      planePm: field.originPm[axis] + kc * field.spacingPm,
    };
  }, [field, axis, offsetPm]);

  useEffect(() => setPoints([]), [field, axis]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !plane || !field) return;
    c.width = plane.W;
    c.height = plane.H;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(plane.W, plane.H);
    const signed = field.kind === "amplitude";
    let maxAbs = 0;
    for (const v of plane.vals) maxAbs = Math.max(maxAbs, Math.abs(v));
    maxAbs ||= 1;
    for (let j = 0; j < plane.H; j++)
      for (let i = 0; i < plane.W; i++) {
        const v = plane.vals[j * plane.W + i];
        let t = Math.abs(v) / maxAbs;
        if (logScale) t = Math.max(0, (Math.log10(Math.max(t, 1e-30)) + logDecades) / logDecades);
        const o = ((plane.H - 1 - j) * plane.W + i) * 4; // +v axis upwards
        if (signed) {
          const [r, g, b] = v >= 0 ? [230, 90, 64] : [64, 128, 230];
          img.data.set([r * t, g * t, b * t, 255], o);
        } else {
          img.data.set([255 * Math.min(1, t * 1.4), 200 * t * t, 80 * t ** 4 + 40 * t, 255], o);
        }
      }
    ctx.putImageData(img, 0, 0);
  }, [plane, field, logScale, logDecades]);

  if (!field || !plane) return <div className="muted">Load a volume to see cross-sections.</div>;

  const extent = (plane.W - 1) * field.spacingPm;
  const toPm = (e: React.MouseEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = 1 - (e.clientY - r.top) / r.height;
    return [field.originPm[plane.ua] + fx * extent, field.originPm[plane.va] + fy * (plane.H - 1) * field.spacingPm];
  };
  const m = measure(points);
  const toPx = (p: Pt) => [
    ((p[0] - field.originPm[plane.ua]) / extent) * 100,
    (1 - (p[1] - field.originPm[plane.va]) / ((plane.H - 1) * field.spacingPm)) * 100,
  ];

  return (
    <div className="slice">
      <div className="slice-canvas">
        <canvas
          ref={canvasRef}
          onClick={(e) => {
            const p = toPm(e);
            setPoints((pts) => (pts.length >= 3 ? [p] : [...pts, p]));
          }}
        />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {points.length > 1 && (
            <polyline points={points.map((p) => toPx(p).join(",")).join(" ")} stroke="#fff" strokeWidth={0.4} fill="none" vectorEffect="non-scaling-stroke" />
          )}
          {points.map((p, i) => {
            const [x, y] = toPx(p);
            return <circle key={i} cx={x} cy={y} r={0.9} fill="#fff" />;
          })}
        </svg>
      </div>
      <div className="slice-info">
        <div>
          Plane {AXES[plane.ua]}–{AXES[plane.va]} at {AXES[axis]} = {formatLength(plane.planePm)}
        </div>
        <div className="muted small">
          Width {formatLength(extent)} · grid spacing {formatLength(field.spacingPm)} ·{" "}
          {field.kind === "amplitude" ? "red ψ > 0, blue ψ < 0" : "colour ∝ density"}
          {logScale ? ` (log, ${logDecades} decades)` : " (linear)"}
        </div>
        <div className="measure">
          <b>Measure</b> (click up to 3 points):
          {points.map((p, i) => (
            <div key={i} className="small">
              P{i + 1}: ({formatLength(p[0])}, {formatLength(p[1])})
            </div>
          ))}
          {m.distances.map((d, i) => (
            <div key={`d${i}`}>
              |P{i + 1}P{i + 2}| = {formatLength(d, 4)}
            </div>
          ))}
          {m.angleDeg !== null && <div>∠P1P2P3 = {m.angleDeg.toFixed(2)}°</div>}
          {points.length > 0 && (
            <button className="small" onClick={() => setPoints([])}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
