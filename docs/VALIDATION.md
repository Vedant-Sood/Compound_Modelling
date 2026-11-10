# Validation

`cd backend && python -m pytest` runs 154 tests (the 4 xTB tests are skipped without tblite). Reference points:

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
| H₂O GFN2-xTB E ≈ −5.07 Eh, charges sum to 0, O negative; optimised r(OH) 0.96 ± 0.02 Å | xtb reference output |
| xTB job through the API (optimise + single point); Z > 86 rejected | — |

| NaCl Fm-3m (225), CN 6/6, Na–Cl = a/2, density 2.16 g/cm³ | Wyckoff (1963); CRC handbook |
| Cu Fm-3m, CN 12, d = a/√2, density within 1 % of 8.96 g/cm³, primitive cell 1 atom | CRC handbook |
| Diamond, Si Fd-3m (227), CN 4, angles 109.47°; Si density 2.329 g/cm³ | CODATA 2018 a(Si) |
| α-Fe Im-3m CN 8 (7.874 g/cm³); graphite P6₃/mmc CN 3, C–C 1.42 Å | Wyckoff; Trucano & Chen (1975) |
| CsCl, CaF₂, ZnS, Mg, TiO₂, SrTiO₃, Al, W space groups; fluorite CN 8/4 | ITA |
| 2×2×2 supercell keeps Fm-3m with 8× atoms; vacancy lowers symmetry, exact composition | — |
| fcc octahedral interstitial has CN 6; d_hkl for cubic and hcp (001) | analytic |
| Display: fcc cell with boundary images has 14 atoms (8 corners + 6 faces) | geometry |
| Regression tests for the October 2026 bug audit (`tests/test_regressions.py`) | — |

Frontend (`npm test`): unit choice and scale bar, representation levels, enclosed threshold,
CUBE layout, undo/redo and quantum-number constraints, measurement geometry, XYZ export,
crystal cell edges, Miller-plane polygons and basis parsing.
