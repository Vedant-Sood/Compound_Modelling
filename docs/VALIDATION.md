# Validation

`cd backend && python -m pytest` runs 126 tests. Reference points:

| Test | Reference |
|---|---|
| Radial normalisation ∫r²R² = 1, n ≤ 6, all l | exact (1e-10) |
| ⟨r⟩ numerical vs a/(2Z)[3n² − l(l+1)] | analytic |
| ψ_1s, ψ_2p0 closed forms | analytic |
| Real Y_lm orthonormal up to l = 3 | Gauss–Legendre quadrature |
| Radial node count and positions (2s node at 2a₀) | analytic |
| H ionization energy 13.5983 eV | NIST ASD 13.598434 eV (±5e-4) |
| H Balmer-α 656.47 nm (vacuum) | NIST |
| He⁺ ionization energy | NIST IE₂(He) |
| 90 % enclosed-probability threshold for 1s | analytic CDF |
| Madelung order = tabulated configs, Z = 1–23 | dataset |
| Cr, Cu, Fe²⁺, Fe³⁺, Mn²⁺, Na⁺, Cl⁻ configurations | standard values |
| Slater Z_eff: N 2p 3.90, Zn 4s 4.35, Zn 3d 8.85, O 1s 7.70, K 4s 2.20 | Slater (1930) textbook values |
| Charge accounting for ions | Σ electrons = Z − q |
| H atom UHF/cc-pVTZ ≈ −0.5 Eh | exact −0.5 Eh |
| H₂ HF/cc-pVDZ r_e = 0.746 Å, E = −1.1287 Eh | NIST CCCBDB |
| H₂O RHF/cc-pVDZ E = −76.027 Eh, dipole ≈ 2.04 D | literature HF values |
| Ne ESP positive and decaying | physical requirement |
| O triplet DFT occupations 5α/3β | — |
| Xe def2-SVP uses ECP and warns | — |
| Pb-208 RMS radius from estimate within 3 % of 5.50 fm | Angeli & Marinova (2013) |
| SCF job end-to-end (He RHF/cc-pVDZ −2.8552 Eh), caching, orbital + ESP from checkpoint | literature |
| H₂O HF/6-31G* optimised r(OH) 0.947 Å, ∠HOH 105.5° | NIST CCCBDB |
| H₂ HF/cc-pVDZ optimisation through the job API: r = 0.746 Å | NIST CCCBDB |
| H₂ bond scan has an interior minimum near 0.75 Å | — |
| MMFF94 relaxes distorted CH₄ to 109.47° | tetrahedral geometry |
| Bond perception from bare XYZ (ethylene C=C) | RDKit DetermineBonds |
| Radical and ion electron accounting, impossible multiplicities rejected | — |

Frontend (`npm test`): unit choice and scale bar, representation levels, enclosed threshold,
CUBE layout, undo/redo and quantum-number constraints, measurement geometry, XYZ export.
