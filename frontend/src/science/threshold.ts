/** Density value rho_t such that voxels with rho > rho_t hold `fraction` of the
 * probability on the grid ("90 % enclosed" isosurfaces). Mirrors the backend. */
export function enclosedThreshold(density: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(density).sort().reverse();
  let total = 0;
  for (let i = 0; i < sorted.length; i++) total += Math.max(sorted[i], 0);
  const target = fraction * total;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += Math.max(sorted[i], 0);
    if (cum >= target) return sorted[i];
  }
  return sorted[sorted.length - 1];
}

export function minMax(a: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  return [lo, hi];
}
