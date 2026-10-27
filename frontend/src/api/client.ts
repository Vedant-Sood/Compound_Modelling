// Typed wrappers around the FastAPI backend.

export interface EncodedArray {
  dtype: "float32";
  shape: number[];
  data: string;
  layout?: string;
}

export interface Prop<T = unknown> {
  value: T | null;
  unit: string | null;
  available: boolean;
  source: string | null;
  method: string | null;
  conditions: string | null;
  notes: string | null;
}

export interface ElementSummary {
  Z: number;
  symbol: string;
  name: string;
  period: number;
  group: number;
  block: string;
  series: string;
  atomic_mass_u: number | null;
}

export interface Isotope {
  mass_number: number;
  mass_u: number;
  abundance_percent: number | null;
  is_stable: boolean | null;
  half_life: number | null;
  half_life_unit: string | null;
  spin: string | null;
}

export interface Occupation {
  subshell: string;
  n: number;
  l: number;
  electrons: number;
  capacity: number;
  slater_zeff: number;
}

export interface ElementDetail {
  summary: ElementSummary;
  charge: number;
  isotope: Isotope | null;
  isotopes: Isotope[];
  particles: { protons: number; neutrons: number | null; electrons: number };
  configuration: { text: string; full: string; method: string; source: string | null };
  occupations: Occupation[];
  unpaired_electrons_hund: number;
  properties: Record<string, Prop>;
  superheavy_note: string | null;
  sources: Record<string, { name: string; license: string; url: string }>;
}

export interface GridInfo {
  origin_pm: number[];
  spacing_pm: number;
  shape: number[];
  half_width_pm?: number;
  riemann_probability?: number;
  riemann_electron_count?: number;
}

export interface HydrogenicOrbital {
  label: string;
  quantum_numbers: { n: number; l: number; m: number };
  basis: "real" | "complex";
  Z: number;
  reduced_mass_ratio: number;
  grid: GridInfo;
  max_density: number;
  thresholds_by_enclosed_fraction: Record<string, number>;
  nodes: { radial: number; angular: number; radial_node_radii_pm: number[] };
  mean_radius_pm: number;
  energy_eV: number;
  volumes: { density: EncodedArray; amplitude?: EncodedArray; phase?: EncodedArray };
  method: string;
}

export interface RadialData {
  r_pm: number[];
  R: number[];
  P_per_pm: number[];
  mean_radius_pm: number;
  most_probable_radius_pm: number;
}

export interface Levels {
  ionization_energy_eV: number;
  reduced_mass_ratio: number;
  levels: { n: number; energy_eV: number; degeneracy: number }[];
  lines: { series: string; upper: number; lower: number; wavelength_nm: number }[];
  method: string;
  limitations: string;
}

export interface OrbitalModel {
  model: "hydrogenic-exact" | "hydrogenic-slater" | "scf";
  description: string;
  Z?: number;
  subshells?: { subshell: string; n: number; l: number; zeff: number }[];
}

export interface SCFOrbital {
  spin: "restricted" | "alpha" | "beta";
  index: number;
  energy_Eh: number;
  energy_eV: number;
  occupation: number;
  character: { ao: string; weight: number }[];
}

export interface SCFResult {
  engine: string;
  engine_version: string;
  solver: string;
  settings: Record<string, unknown>;
  n_electrons: number;
  n_basis_functions: number;
  spin_2S: number;
  ecp: boolean;
  converged: boolean;
  energy_Eh: number;
  energy_eV: number;
  s_squared: number | null;
  cycles: { cycle: number; energy_Eh: number }[];
  wall_time_s: number;
  orbitals: SCFOrbital[];
  homo_lumo_gap_eV: number | null;
  dipole_debye: number[];
  mulliken_charges: number[];
  warnings: string[];
  grid: GridInfo;
  volumes: { density: EncodedArray; spin_density?: EncodedArray };
  atoms: [string, number[]][];
}

export interface Job<R = SCFResult> {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  logs: { t: number; message: string }[];
  error: string | null;
  cached: boolean;
  elapsed_s: number;
  result?: R;
}

export interface VolumeResponse {
  grid: GridInfo;
  volume: EncodedArray;
  quantity: string;
  min?: number;
  max?: number;
  energy_Eh?: number;
  occupation?: number;
  index?: number;
  spin?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep status text */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const api = {
  health: () => request<{ status: string; version: string; engines: Record<string, string | null> }>("/api/health"),
  elements: () => request<{ elements: ElementSummary[] }>("/api/elements"),
  element: (symbol: string, charge: number, massNumber?: number | null) =>
    request<ElementDetail>(`/api/elements/${symbol}?${qs({ charge, mass_number: massNumber })}`),
  orbitalModels: (symbol: string, charge: number) =>
    request<{ models: OrbitalModel[]; electrons: number }>(`/api/atoms/${symbol}/orbital-models?${qs({ charge })}`),
  hydrogenic: (p: {
    n: number;
    l: number;
    m: number;
    Z: number;
    symbol?: string;
    mass_number?: number | null;
    basis: "real" | "complex";
    points: number;
  }) => request<HydrogenicOrbital>(`/api/hydrogenic/orbital?${qs(p)}`),
  radial: (p: { n: number; l: number; Z: number; symbol?: string; mass_number?: number | null }) =>
    request<RadialData>(`/api/hydrogenic/radial?${qs(p)}`),
  levels: (p: { Z: number; n_max: number; symbol?: string; mass_number?: number | null }) =>
    request<Levels>(`/api/hydrogenic/levels?${qs(p)}`),
  calcOptions: () =>
    request<{ methods: string[]; basis_sets: string[]; xc_functionals: string[]; modes: Record<string, string> }>(
      "/api/calc/options",
    ),
  submitSCF: (body: Record<string, unknown>) =>
    request<Job>("/api/jobs/scf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<Job>(`/api/jobs/${id}`, { method: "DELETE" }),
  jobOrbital: (id: string, spin: string, index: number) =>
    request<VolumeResponse>(`/api/jobs/${id}/orbital?${qs({ spin, index })}`),
  jobESP: (id: string) => request<VolumeResponse>(`/api/jobs/${id}/esp`),
};

export function decodeArray(a: EncodedArray): Float32Array {
  const bin = atob(a.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
