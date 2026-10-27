# Known limitations

- Hydrogen-like orbitals are non-relativistic with a point nucleus.
- Atomic SCF uses symmetry-broken UHF/UKS for open shells; the result is not a pure term state
  (e.g. not exactly ³P for O) and can converge to an excited configuration for transition metals.
- ECP calculations show valence density only.
- Grid electron counts are Riemann sums on the display grid; nuclear cusps are under-resolved,
  so they are diagnostics rather than accurate integrals.
- Ion configurations not in the dataset come from a removal/addition rule and may be wrong for
  some lanthanide/actinide ions. Elements without a tabulated configuration (Z ≥ 104 in the
  source) use a Madelung prediction, labelled as such.
- The source dataset contains theoretical predictions for some superheavy-element properties;
  the UI flags Z > 103.
- Atomic "energy levels" for many-electron atoms are canonical orbital energies (Koopmans), not
  spectroscopic term energies.
- Semiempirical (xTB) "balanced mode" is not integrated yet.
- Bond scans are rigid (only one atom moves) and use the chosen reference; restricted HF/DFT
  does not dissociate homolytic bonds correctly.
- MMFF/UFF energies are force-field steric energies and are never compared with quantum energies.
- Coordination compounds work in the quantum engine, but RDKit Lewis-structure perception and
  MMFF parameters are often unavailable for metal centres (UFF is used when possible).
- Atom placement in the builder uses covalent radii and a simple "away from neighbours"
  direction; use force-field clean-up or quantum optimisation for real geometries.
- WebGL float-texture linear filtering is required for smooth rendering; without it the renderer
  falls back to nearest-neighbour sampling.
- Crystal, alloy, compound-discovery and molecular-dynamics workspaces are not built
  yet (see ROADMAP.md); the UI says so instead of showing placeholder results.
