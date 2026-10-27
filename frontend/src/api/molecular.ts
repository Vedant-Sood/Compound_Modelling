// Molecular Builder API wrappers.
import type { Job, SCFResult } from "./client";

export interface MolAtom {
  symbol: string;
  xyz: [number, number, number]; // Å
}
export interface MolBond {
  i: number;
  j: number;
  order: number; // 1, 1.5, 2, 3
}
export interface MoleculeJSON {
  atoms: MolAtom[];
  bonds: MolBond[];
  charge: number;
  multiplicity: number;
}

export interface Analysis {
  formula: string;
  molecular_weight_g_mol: number;
  smiles: string | null;
  n_electrons: number;
  radical_electrons_lewis: number;
  problems: string[];
}

export interface DisplayData {
  covalent_radius_angstrom: Record<string, number>;
  colour: Record<string, string>;
  source: string;
}

export interface OptStep {
  step: number;
  energy_Eh: number;
  fmax_eV_per_A: number;
}

export interface GeomOptResult extends SCFResult {
  optimisation: { optimiser: string; fmax_eV_per_A: number; converged: boolean; steps: OptStep[] };
  molecule: MoleculeJSON;
}

export interface XTBResult {
  engine: string;
  engine_version: string;
  solver: string; // GFN2-xTB | GFN1-xTB
  energy_Eh: number;
  orbitals: { index: number; energy_eV: number; occupation: number }[];
  homo_lumo_gap_eV: number | null;
  dipole_debye: number[];
  atomic_charges: number[];
  charge_model: string;
  wall_time_s: number;
  warnings: string[];
  molecule: MoleculeJSON;
  optimisation?: { optimiser: string; fmax_eV_per_A: number; converged: boolean; steps: OptStep[] };
}

export interface ScanResult {
  points: { r_angstrom: number; energy_Eh: number; converged: boolean }[];
  bond: [number, number];
  minimum_on_grid: { r_angstrom: number; energy_Eh: number };
  method: string;
  notes: string;
}

export interface FFResult {
  molecule: MoleculeJSON;
  method: string;
  converged: boolean;
  initial_energy_kcal_mol: number;
  final_energy_kcal_mol: number;
  notes: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? res.statusText));
  return data as T;
}

export const molApi = {
  examples: () => fetch("/api/molecule/examples").then((r) => r.json() as Promise<{ examples: Record<string, string> }>),
  displayData: () => fetch("/api/molecule/display-data").then((r) => r.json() as Promise<DisplayData>),
  fromSmiles: (smiles: string) =>
    post<{ molecule: MoleculeJSON; geometry_method: string; analysis: Analysis }>("/api/molecule/from-smiles", { smiles }),
  analyze: (m: MoleculeJSON, perceive = false) =>
    post<{ molecule: MoleculeJSON; analysis: Analysis }>(`/api/molecule/analyze?perceive_bonds=${perceive}`, m),
  addHydrogens: (m: MoleculeJSON) => post<{ molecule: MoleculeJSON; added: number }>("/api/molecule/add-hydrogens", m),
  forceField: (m: MoleculeJSON) => post<FFResult>("/api/molecule/forcefield-optimize", m),
  scf: (body: Record<string, unknown>) => post<Job>("/api/molecule/jobs/scf", body),
  geomopt: (body: Record<string, unknown>) => post<Job<GeomOptResult>>("/api/molecule/jobs/geomopt", body),
  scan: (body: Record<string, unknown>) => post<Job<ScanResult>>("/api/molecule/jobs/scan", body),
  xtb: (body: Record<string, unknown>) => post<Job<XTBResult>>("/api/molecule/jobs/xtb", body),
};
