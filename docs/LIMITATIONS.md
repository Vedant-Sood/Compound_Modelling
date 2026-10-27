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
- WebGL float-texture linear filtering is required for smooth rendering; without it the renderer
  falls back to nearest-neighbour sampling.
- Molecular, crystal, alloy, compound-discovery and molecular-dynamics workspaces are not built
  yet (see ROADMAP.md); the UI says so instead of showing placeholder results.
