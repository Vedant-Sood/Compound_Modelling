// Pure geometry helpers for the Crystal Explorer (no three.js), unit tested.

export type Vec3 = [number, number, number];

export const fracToCart = (f: Vec3, cell: number[][]): Vec3 => [
  f[0] * cell[0][0] + f[1] * cell[1][0] + f[2] * cell[2][0],
  f[0] * cell[0][1] + f[1] * cell[1][1] + f[2] * cell[2][1],
  f[0] * cell[0][2] + f[1] * cell[1][2] + f[2] * cell[2][2],
];

/** The 12 edges of the box [0,n1]×[0,n2]×[0,n3] in fractional coordinates. */
export function boxEdges(n: Vec3): [Vec3, Vec3][] {
  const corners = boxCorners(n);
  const out: [Vec3, Vec3][] = [];
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++) {
      const diff = corners[a].filter((x, i) => x !== corners[b][i]).length;
      if (diff === 1) out.push([corners[a], corners[b]]);
    }
  return out;
}

function boxCorners(n: Vec3): Vec3[] {
  const c: Vec3[] = [];
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) c.push([i * n[0], j * n[1], k * n[2]]);
  return c;
}

/**
 * Polygons where the lattice planes (hkl) cut the box [0,n1]×[0,n2]×[0,n3], in fractional
 * coordinates. Plane m: h x + k y + l z = m for every integer m that intersects the box.
 */
export function millerPlanePolygons(hkl: Vec3, n: Vec3 = [1, 1, 1]): Vec3[][] {
  const [h, k, l] = hkl;
  if (!h && !k && !l) return [];
  const corners = boxCorners(n);
  const val = (p: Vec3) => h * p[0] + k * p[1] + l * p[2];
  const vals = corners.map(val);
  const lo = Math.ceil(Math.min(...vals) - 1e-9);
  const hi = Math.floor(Math.max(...vals) + 1e-9);
  const edges: [number, number][] = [];
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++) if (corners[a].filter((x, i) => x !== corners[b][i]).length === 1) edges.push([a, b]);
  const polys: Vec3[][] = [];
  for (let m = lo; m <= hi; m++) {
    const pts: Vec3[] = [];
    for (const [a, b] of edges) {
      const va = vals[a] - m;
      const vb = vals[b] - m;
      if (Math.abs(va) < 1e-9) pts.push(corners[a]);
      if (va * vb < 0) {
        const t = va / (va - vb);
        pts.push(corners[a].map((x, i) => x + t * (corners[b][i] - x)) as Vec3);
      }
    }
    const uniq = [...new Map(pts.map((p) => [p.map((x) => x.toFixed(6)).join(","), p])).values()];
    if (uniq.length < 3) continue;
    polys.push(sortAroundCentroid(uniq, [h, k, l]));
  }
  return polys;
}

function sortAroundCentroid(pts: Vec3[], normal: Vec3): Vec3[] {
  const c = pts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as Vec3, [0, 0, 0] as Vec3).map((x) => x / pts.length) as Vec3;
  // in-plane basis
  const nrm = Math.hypot(...normal);
  const nn = normal.map((x) => x / nrm) as Vec3;
  const ref: Vec3 = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(nn, ref);
  const v = cross(nn, u);
  return [...pts].sort((p, q) => {
    const dp = p.map((x, i) => x - c[i]);
    const dq = q.map((x, i) => x - c[i]);
    return Math.atan2(dot(dp, v), dot(dp, u)) - Math.atan2(dot(dq, v), dot(dq, u));
  });
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function formulaFromComposition(c: Record<string, number>): string {
  const counts = Object.values(c);
  const g = counts.reduce((a, b) => gcd(a, b), counts[0] ?? 1);
  return Object.entries(c)
    .map(([s, n]) => `${s}${n / g === 1 ? "" : n / g}`)
    .join("");
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Parse "Na 0 0 0" lines into species + fractional coordinates. */
export function parseBasis(text: string): { species: string[]; frac: number[][] } {
  const species: string[] = [];
  const frac: number[][] = [];
  text.split(/\n/).forEach((line, k) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = t.split(/[\s,]+/);
    const xyz = parts.slice(1, 4).map(Number);
    if (parts.length < 4 || xyz.some((x) => !Number.isFinite(x))) throw new Error(`line ${k + 1}: expected "Symbol x y z" with fractional coordinates`);
    species.push(parts[0]);
    frac.push(xyz);
  });
  if (!species.length) throw new Error("basis is empty");
  return { species, frac };
}
