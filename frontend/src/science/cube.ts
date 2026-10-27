// Gaussian CUBE export of a volume on a regular grid.

import { BOHR_PM } from "./units";

export interface CubeAtom {
  Z: number;
  positionPm: [number, number, number];
}

/** values are x-fastest (the renderer layout); CUBE files list z fastest. */
export function writeCube(
  comment: string,
  values: Float32Array,
  shape: [number, number, number],
  originPm: [number, number, number],
  spacingPm: number,
  atoms: CubeAtom[],
): string {
  const [nx, ny, nz] = shape;
  const b = (pm: number) => (pm / BOHR_PM).toFixed(6).padStart(12);
  const lines = [
    "Chemical Modelling volume export",
    comment,
    `${String(atoms.length).padStart(5)}${originPm.map(b).join("")}`,
    `${String(nx).padStart(5)}${b(spacingPm)}${b(0)}${b(0)}`,
    `${String(ny).padStart(5)}${b(0)}${b(spacingPm)}${b(0)}`,
    `${String(nz).padStart(5)}${b(0)}${b(0)}${b(spacingPm)}`,
    ...atoms.map((a) => `${String(a.Z).padStart(5)}${a.Z.toFixed(6).padStart(12)}${a.positionPm.map(b).join("")}`),
  ];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      let row: string[] = [];
      for (let k = 0; k < nz; k++) {
        row.push(values[i + nx * (j + ny * k)].toExponential(5));
        if (row.length === 6) {
          lines.push(row.join(" "));
          row = [];
        }
      }
      if (row.length) lines.push(row.join(" "));
    }
  return lines.join("\n") + "\n";
}
