# Scientific methodology

## Hydrogen-like orbitals (exact)

ψ_nlm = R_nl(r) Y_lm(θ, φ) for one electron and a point nucleus of charge Z, non-relativistic.
R_nl uses generalised Laguerre polynomials; Y_lm comes from `scipy.special.sph_harm_y` with the
Condon–Shortley phase. Real orbitals are the standard tesseral combinations (m = +1 → p_x,
m = −1 → p_y, etc.). The finite nuclear mass enters through the reduced mass μ = M m_e/(M + m_e),
which scales lengths by m_e/μ and energies by μ/m_e. The nuclear mass is the isotope atomic mass
minus Z electron masses.

Energies: E_n = −(μ/m_e) Z² R∞hc / n². Fine structure, Lamb shift and hyperfine structure are not
included (≈1e-5 relative for H).

## Slater-screened hydrogenic orbitals (approximate)

For many-electron atoms the UI can show the hydrogen-like shape of one subshell with
Z_eff from Slater's rules. This is labelled as an approximation; the SCF model is the real calculation.

## Self-consistent field (PySCF)

RHF/ROHF/UHF or RKS/ROKS/UKS. Open shells default to unrestricted; the default 2S follows
Hund's rule for the configuration. If DIIS fails, a second-order (Newton) solver is tried and the
result is flagged when still unconverged. Heavy elements (Z > 36) with def2 basis sets use the
matching ECP, and densities then contain valence electrons only (flagged). ⟨S²⟩ is reported and
spin contamination > 0.05 is flagged.

Densities, orbitals and ESP are evaluated with `pyscf.dft.numint` and `int1e_grids` on a cubic
grid. For atoms the grid half-width encloses 99.9 % of the electrons (spherical average).

## Isosurfaces

An isosurface value is chosen so the enclosed region contains a stated fraction of the
probability on the grid (sorted cumulative sum), instead of an arbitrary density cut. For
amplitudes the surface is |ψ| = √ρ_t and the colour shows the sign of ψ; for complex orbitals the
hue shows arg ψ. ESP is mapped on the ρ = 0.001 e/bohr³ surface by default.

## Volume rendering

Emission–absorption ray marching with extinction proportional to the mapped density (linear or
log over N decades). This is a visual transfer function: colour and opacity are not physical
quantities, but the geometry and coordinates are.

## Nuclear size

R = 1.2 fm · A^(1/3) (equivalent uniform sphere; RMS charge radius ≈ 0.775 R). An estimate,
labelled as such.
