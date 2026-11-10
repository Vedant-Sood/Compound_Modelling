// Crystal Explorer API wrappers. Structures use the backend JSON schema:
// cell rows are lattice vectors in Å, coordinates are fractional.

export interface CrystalStructure {
  cell: number[][];
  species: string[];
  frac_coords: number[][];
  pbc: boolean[];
}

export interface Wyckoff {
  index: number;
  species: string;
  letter: string;
  site_symmetry: string;
  equivalent_to: number;
}

export interface Symmetry {
  international: string;
  number: number;
  hall: string;
  point_group: string;
  crystal_system: string;
  bravais_centring: string;
  n_operations: number;
  wyckoff: Wyckoff[];
  symprec_angstrom: number;
  engine: string;
  error?: string;
}

export interface CoordRow {
  index: number;
  species: string;
  cn: number;
  nearest_angstrom: number | null;
  shell_max_angstrom?: number;
  neighbours: Record<string, number>;
  second_shell_angstrom: number | null;
}

export interface CrystalReport {
  structure: CrystalStructure;
  n_atoms: number;
  composition: Record<string, number>;
  lattice: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number; volume_angstrom3: number };
  density_g_cm3: { value: number; method: string };
  symmetry: Symmetry;
  coordination: CoordRow[];
  coordination_method: string;
  provenance?: string;
  hypothetical?: boolean; // set by build/defect; derived cells inherit the parent's value
}

export interface DisplayGeometry {
  atoms: { symbol: string; xyz: [number, number, number]; site: number }[];
  bonds: { i: number; j: number; order: number; length_angstrom: number }[];
  cell: number[][];
  repeats: [number, number, number];
  boundary_images: boolean;
}

export interface SiteInfo {
  index: number;
  species: string;
  frac: number[];
  coordination: CoordRow;
  bond_angles_deg: number[];
  neighbours: { index: number; species: string; distance_angstrom: number; image: number[] }[];
}

export interface ExampleInfo {
  source: string;
  kind: string;
  spacegroup: number;
  cellpar: number[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.statusText));
  return data as T;
}

export const crystalApi = {
  examples: () => fetch("/api/crystal/examples").then((r) => r.json() as Promise<{ examples: Record<string, ExampleInfo> }>),
  build: (body: { name?: string; cellpar?: number[]; species?: string[]; frac_coords?: number[][]; spacegroup?: number | null }) =>
    post<CrystalReport>("/api/crystal/build", body),
  analyse: (structure: CrystalStructure, symprec = 1e-3, tolerance = 0.1) => post<CrystalReport>("/api/crystal/analyse", { structure, symprec, tolerance }),
  standardise: (structure: CrystalStructure, kind: "primitive" | "conventional") => post<CrystalReport>("/api/crystal/standardise", { structure, kind }),
  supercell: (structure: CrystalStructure, repeats: number[]) => post<CrystalReport>("/api/crystal/supercell", { structure, repeats }),
  display: (structure: CrystalStructure, repeats: number[], boundary: boolean, tolerance = 0.1) =>
    post<DisplayGeometry>("/api/crystal/display", { structure, repeats, boundary, tolerance }),
  site: (structure: CrystalStructure, index: number, tolerance = 0.1) => post<SiteInfo>("/api/crystal/site", { structure, index, tolerance }),
  plane: (structure: CrystalStructure, hkl: number[]) => post<{ hkl: number[]; normal: number[]; d_spacing_angstrom: number }>("/api/crystal/plane", { structure, hkl }),
  defect: (structure: CrystalStructure, body: { kind: "vacancy" | "substitution" | "interstitial"; index?: number; species?: string; frac?: number[] }) =>
    post<CrystalReport>("/api/crystal/defect", { structure, ...body }),
};
