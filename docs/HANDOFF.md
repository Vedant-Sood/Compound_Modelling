# Handoff plan for a second coding agent

This document lets a second agent work on Chemical Modelling in parallel without colliding with
the primary agent. Read the full product spec (provided by the project owner), then
[ARCHITECTURE.md](ARCHITECTURE.md), [METHODOLOGY.md](METHODOLOGY.md) and this file.

## 1. Current state (Phase 1 done)

Merged/available on `main` once the Phase 1 PR lands (until then branch from
`claude/project-thread-m2hm0h`):

- Backend (`backend/chemmodel`): element dataset with provenance, analytic hydrogen-like
  orbitals, PySCF HF/DFT engine for atoms *and* molecules (`quantum/scf.py`), background job
  manager with cancel + cache (`jobs/`), FastAPI routers (`api/`). 117 passing tests.
- Frontend (`frontend/src`): workstation shell with top toolbar, Atomic Explorer workspace,
  GPU volume renderer, periodic table, plots, cross-sections, save/open, undo/redo.
- Docs: README, ARCHITECTURE, METHODOLOGY, LIMITATIONS, VALIDATION, ROADMAP.

Environment that is known to work: Python 3.13, numpy 2.5, scipy 1.18, PySCF 2.14, ASE 3.29,
spglib 2.8, RDKit 2026.09, Node 22, React 18.3, Three.js 0.169, Vite 6.4, Vitest 4.1 (Node ≥ 20).
Note: `pip install pymatgen` currently fails to build `bibtexparser`; only the data-generation
script needs pymatgen, and it works with `pymatgen-core` installed with `--no-deps` plus its
runtime deps.

## 2. Ground rules (apply to every workstream)

1. **No fabricated science.** Every number shown must come from a calculation, a cited dataset,
   or be explicitly labelled as an estimate. Missing data is returned as unavailable
   (`prop(None, ...)` in `api/atomic.py`). Never animate or render placeholder "results".
2. Use the existing conventions: pm for UI lengths, Å for user coordinates, bohr inside quantum
   code; `encode_volume`/`decodeArray` for arrays; `prop(...)` for properties with provenance.
3. Anything slower than ~1 s goes through the job manager: add a function to `TASKS`
   in a **new** task module and register it (see section 4 for the one shared line).
4. Each feature ships with validation tests against a stated reference (value + source in
   the test comment), added to `docs/VALIDATION.md`.
5. Branch from `main`, one PR per workstream milestone, small and reviewable.
   `cd backend && python -m pytest` and `cd frontend && npm test && npm run typecheck && npm run build`
   must pass.
6. Do not rewrite files owned by another workstream. If you need a change there, open an issue
   or leave a note in the PR describing the exact change.

## 3. Ownership

| Area | Owner |
|---|---|
| `backend/chemmodel/atomic/`, `quantum/`, `jobs/manager.py`, `api/atomic.py`, `api/calc.py` | Primary (A) |
| `frontend/src/components/AtomicExplorer.tsx`, `render/VolumeRenderer.ts`, `state/atomic.ts` | Primary (A) |
| New `molecular/` modules, Molecular workspace | Primary (A) |
| `crystal/` modules, Crystal workspace (`components/crystal/`, `render/CellOverlay.ts`) | Primary (A), done 2026-10-28 |
| New `io/` and `databases/` modules | **Second agent (C)** |
| CI, packaging (`.github/`, `scripts/`) | **Second agent (D)** |
| `App.tsx`, `api/main.py`, `jobs/tasks.py`, `api/client.ts`, `styles.css`, docs index files | Shared: append-only, see section 4 |

## 4. Shared integration points (append-only)

To plug a new workspace in, the only edits allowed to shared files are:

- `backend/chemmodel/api/main.py`: one `from chemmodel.api import <module>` and one
  `app.include_router(<module>.router)` line.
- `backend/chemmodel/jobs/tasks.py`: one line `TASKS.update(<your_tasks_module>.TASKS)` at the
  bottom (put your task functions in your own module, e.g. `chemmodel/crystal/tasks.py`).
- `frontend/src/App.tsx`: render your workspace component in place of the placeholder for your
  mode id (`crystal`, `alloys`, ...). Do not touch other modes.
- `frontend/src/api/client.ts`: do not edit. Put your API wrappers in
  `frontend/src/api/<area>.ts` and import the generic `decodeArray` from `client.ts`.
- `frontend/src/styles.css`: do not edit; create `frontend/src/components/<area>/<area>.css`
  and import it from your component. Reuse existing classes (`.workspace`, `.panel`, `.props`,
  `.badge`, `.tabs`, ...).
- `docs/VALIDATION.md`, `docs/ROADMAP.md`: append rows for your area only.

## 5. Workstreams for the second agent

**Update 2026-10-28: workstream B is done by the primary agent (on `main` once its PR merges).
The second agent should skip B and start with C, then D.** B's description is kept below for
reference; the implementation follows it, with the API under `/api/crystal/*`.

### Workstream B — Crystal Explorer (spec section 5 Mode D, Phase 3) — DONE (primary agent)

Branch: (built by the primary agent; do not start `agent2/crystal-explorer`)

Backend (new package `backend/chemmodel/crystal/`):
- `structures.py`: build example crystals with ASE (`ase.build.bulk`, `ase.lattice`, `ase.spacegroup.crystal`)
  using experimental lattice constants with a cited source in a `REFERENCE_STRUCTURES` table:
  NaCl (rocksalt), diamond, Si, Cu (FCC), α-Fe (BCC), graphite (hexagonal). Each entry: lattice
  parameters, source, temperature of measurement.
- `symmetry.py`: spglib space group (symbol + number), Bravais lattice, primitive and
  conventional standardisation, Wyckoff positions. Use `symprec` as a parameter and return it.
- `analysis.py`: supercells, coordination numbers and nearest-neighbour distances under periodic
  boundary conditions (`ase.neighborlist`), density (g/cm³) from cell volume and masses,
  Miller-plane geometry (normal, d-spacing), lattice parameter edits.
- `defects.py`: vacancy, substitution, interstitial (user-specified site); return the modified
  structure and its new symmetry. Label results as hypothetical structures.
- `api/crystal.py`: `/api/crystal/examples`, `/api/crystal/build`, `/api/crystal/symmetry`,
  `/api/crystal/supercell`, `/api/crystal/coordination`, `/api/crystal/plane`, `/api/crystal/defect`.
  Structures are exchanged as JSON `{cell: 3x3 Å, species: [], frac_coords: [[...]], pbc: [true]*3}`.

Frontend (new folder `frontend/src/components/crystal/` and `frontend/src/render/StructureRenderer.ts`):
- Structure renderer with **instanced meshes** for atoms (radius from covalent or ionic radius,
  stated in a legend), unit-cell wireframe, bonds by distance cutoff, Miller plane overlay,
  pm scene units so the existing scale bar logic (`science/units.ts`) can be reused.
- Crystal workspace: example picker, lattice parameter inputs, primitive/conventional toggle,
  supercell (n1, n2, n3), symmetry panel, coordination table, defect tools, export (CIF via C).

Acceptance tests (backend):
- NaCl: Fm-3m (225), cation and anion coordination 6, Na–Cl distance a/2.
- Cu: Fm-3m (225), CN 12, nearest neighbour a/√2; density within 1 % of 8.96 g/cm³.
- Diamond and Si: Fd-3m (227), CN 4, tetrahedral angle 109.47°.
- α-Fe: Im-3m (229), CN 8.
- Graphite: P6₃/mmc (194).
- Supercell 2×2×2 has 8× atoms and the same space group; a vacancy lowers the symmetry and the
  composition accounting is exact.
- Primitive cell of FCC Cu has 1 atom.

### Workstream C — Scientific file formats and databases (sections 2, 7, 14)

Branch: `agent2/io-databases`

Backend (new packages `backend/chemmodel/io/` and `backend/chemmodel/databases/`):
- Periodic structures must use `chemmodel.crystal.structures.Structure` (`from_ase`, `to_json`)
  so imported CIF/POSCAR files open directly in the Crystal Explorer via `/api/crystal/analyse`.
  The Crystal workspace has an Open button for its own JSON; add CIF/POSCAR import there by
  calling your endpoint, or tell the primary agent the endpoint name in your PR.
- `io/formats.py`: read/write XYZ, CIF, PDB, POSCAR/CONTCAR via ASE; MOL/SDF via RDKit; Gaussian
  CUBE read/write (volumes + atoms; match the layout used by `frontend/src/science/cube.ts`);
  JSON (the structure schema in workstream B). Endpoints `/api/io/import` (multipart upload) and
  `/api/io/export`.
- `databases/cache.py`: on-disk cache (`~/.chemmodel/db-cache`, overridable by env var) keyed by
  query, storing raw responses plus retrieval time, source URL and licence, so the app works
  offline for anything fetched once.
- `databases/pubchem.py`: PUG REST (name/formula/CID search, 3D SDF, computed properties).
  Respect the documented rate limit (≤ 5 requests/s).
- `databases/materials_project.py`: `mp-api` client, API key from env `MP_API_KEY` (never stored
  in the repo); search by elements/chemsys; return formula, structure, space group, formation
  energy per atom, energy above hull, band gap, `theoretical` flag, with "computed (DFT, MP)"
  provenance.
- `databases/optimade.py`: generic OPTIMADE client (structures endpoint, `filter=elements HAS ALL ...`)
  configurable provider list.
- `api/databases.py`: `/api/db/search?elements=...&source=...`, `/api/db/record/{source}/{id}`.
  Every record carries `source`, `method` (experimental / computed), `retrieved_at`, `licence`.

Acceptance tests: round-trip each format on water and NaCl (coordinates within 1e-6 Å, cell
within 1e-6); CUBE written by Python is read back identically; database clients tested against
recorded fixture responses (no live network in CI) and one optional live test marked
`@pytest.mark.network`; offline mode returns cached data and a clear "not cached" error otherwise.

### Workstream D — CI and packaging (sections 16, 17 Phase 6)

Branch: `agent2/ci-packaging`

- GitHub Actions: backend pytest on Ubuntu (Python 3.11 and 3.13), frontend typecheck/test/build.
  Network tests excluded.
- Verify `scripts/start-windows.ps1` on a real Windows 11 + WSL2 machine and fix it; add a
  `scripts/install-wsl.md` with exact steps.
- Pin frontend dependencies with `package-lock.json` (already present) and backend with a
  generated lock (`pip-compile` or `uv lock`).
- Optional: a GitHub Release workflow that attaches the built `frontend/dist`.

Acceptance: CI green on a PR; fresh-clone install on Windows following the docs reaches the
Atomic Explorer and renders hydrogen 1s.

## 6. What the primary agent is doing next (do not duplicate)

Update: Phase 2 (Molecular Builder) is done. `render/VolumeRenderer.ts` now exposes a `solids`
group (opaque geometry composited with volumes via a depth pre-pass), `pick()`,
`pointOnViewPlane()` and `frameView()`. Workstream B can reuse these for crystal rendering by
adding its own layer to `renderer.solids` (see `render/StructureLayer.ts`) instead of writing a
new renderer.


Done since: xTB balanced mode (PR #3), dev-tool audit fix (PR #4), bug audit and the Crystal
Explorer (workstream B). Next for A: Atomic Explorer polish, then Phase 4 planning once C lands.

Workstream A, branch `claude/...`:
1. Molecular Builder (Phase 2): place/remove atoms, bonds and bond orders (RDKit), measurement,
   HF/DFT single points and geometry optimisation (PySCF gradients + ASE optimiser), molecular
   orbitals and densities through the existing volume renderer, comparison of conformers;
   validation for H₂ bond curve, H₂O geometry, MO visualisation.
2. Balanced mode via optional xTB (`tblite`/`xtb-python`) if installable; otherwise documented as
   optional.
3. Atomic Explorer polish.

Phase 4 (alloys, compound discovery, convex hulls) depends on B and C and will be split again
once those land.

## 7. Communication

Put questions and cross-workstream change requests in the PR description. Keep
`docs/ROADMAP.md` status rows for your workstream up to date in each PR.
