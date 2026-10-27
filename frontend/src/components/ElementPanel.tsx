import type { ElementDetail, Prop } from "../api/client";

const LABELS: Record<string, string> = {
  atomic_mass: "Atomic mass",
  isotope_mass: "Isotope mass",
  valence_electrons: "Valence electrons",
  ground_level: "Ground level",
  next_ionization_energy: "Ionization energy (this species)",
  ionization_energies: "Ionization energies",
  electron_affinity: "Electron affinity",
  electronegativity_pauling: "Electronegativity (Pauling)",
  atomic_radius_empirical: "Atomic radius (empirical)",
  atomic_radius_calculated: "Atomic radius (calculated)",
  van_der_waals_radius: "van der Waals radius",
  metallic_radius: "Metallic radius",
  ionic_radii_shannon: "Ionic radii (Shannon)",
  oxidation_states: "Oxidation states",
  common_oxidation_states: "Common oxidation states",
  nuclear_radius_estimate: "Nuclear radius (estimate)",
};

function renderValue(key: string, p: Prop): string {
  if (!p.available) return "unavailable";
  const v = p.value as unknown;
  if (key === "ionization_energies" && Array.isArray(v)) {
    const shown = (v as number[]).slice(0, 4).map((x) => x.toFixed(3)).join(", ");
    return `${shown}${v.length > 4 ? ` … (${v.length})` : ""} ${p.unit}`;
  }
  if (key === "ionic_radii_shannon" && Array.isArray(v)) {
    return (v as { coordination: string; spin: string | null; ionic_radius_pm: number }[])
      .map((r) => `${r.ionic_radius_pm} pm (CN ${r.coordination}${r.spin ? `, ${r.spin}` : ""})`)
      .join("; ");
  }
  if (Array.isArray(v)) return v.map((x) => (x > 0 ? `+${x}` : `${x}`)).join(", ");
  if (typeof v === "number") return `${Number(v.toPrecision(7))}${p.unit ? ` ${p.unit}` : ""}`;
  return `${v}${p.unit ? ` ${p.unit}` : ""}`;
}

export function provenance(p: Prop): string {
  return [p.method, p.source && `source: ${p.source}`, p.conditions, p.notes].filter(Boolean).join(" · ");
}

export function PropertyTable({ detail }: { detail: ElementDetail }) {
  return (
    <table className="props">
      <tbody>
        {Object.entries(LABELS).map(([key, label]) => {
          const p = detail.properties[key];
          if (!p) return null;
          return (
            <tr key={key} title={provenance(p)} className={p.available ? "" : "unavail"}>
              <th>{label}</th>
              <td>{renderValue(key, p)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ElementHeader({ detail }: { detail: ElementDetail }) {
  const s = detail.summary;
  const q = detail.charge;
  const charge = q === 0 ? "" : `${Math.abs(q) > 1 ? Math.abs(q) : ""}${q > 0 ? "+" : "−"}`;
  return (
    <div className="el-header">
      <div className="el-sym">
        {detail.isotope && <sup>{detail.isotope.mass_number}</sup>}
        {s.symbol}
        {charge && <sup>{charge}</sup>}
      </div>
      <div>
        <div className="el-name">{s.name}</div>
        <div className="muted">
          Z = {s.Z} · {s.series} · {s.block}-block · period {s.period}
        </div>
        <div>
          p<sup>+</sup> {detail.particles.protons} · n {detail.particles.neutrons ?? "—"} · e<sup>−</sup>{" "}
          {detail.particles.electrons}
        </div>
      </div>
    </div>
  );
}

export function ConfigurationView({ detail }: { detail: ElementDetail }) {
  const c = detail.configuration;
  return (
    <div className="config">
      <div className="config-text" title={c.full}>
        {c.text}
      </div>
      <div className="muted small">
        {c.method}
        {c.source ? ` (${c.source})` : ""} · unpaired (Hund): {detail.unpaired_electrons_hund}
      </div>
      <div className="occupations">
        {detail.occupations.map((o) => (
          <div key={o.subshell} className="occ" title={`Slater Z_eff = ${o.slater_zeff}`}>
            <span>{o.subshell}</span>
            <div className="occ-bar">
              <div style={{ width: `${(100 * o.electrons) / o.capacity}%` }} />
            </div>
            <span className="small">
              {o.electrons}/{o.capacity}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
