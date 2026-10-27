# Architecture

```
backend/chemmodel/
  units.py               CODATA constants (scipy.constants), length units
  encoding.py            float32/base64 array encoding; volumes are x-fastest
  data/elements.json     generated offline element dataset (do not hand-edit)
  atomic/
    hydrogenic.py        analytic one-electron orbitals, energies, grids, thresholds
    elements.py          dataset access, configurations, valence, Slater rules
  quantum/
    scf.py               PySCF HF/DFT, grids, densities, orbitals, ESP (atoms + molecules)
  jobs/
    manager.py           one process per job, cancel = terminate, disk cache by params hash
    tasks.py             job kinds (TASKS dict) + checkpoint post-processing
  api/
    main.py              FastAPI app, routers, /api/health, serves frontend/dist
    atomic.py            /api/elements, /api/hydrogenic/*, /api/atoms/*
    calc.py              /api/jobs/*, /api/calc/options
backend/scripts/build_element_data.py
backend/tests/           pytest scientific validation

frontend/src/
  api/client.ts          typed API wrappers, array decoding
  render/VolumeRenderer.ts  Three.js ray-marching volume/isosurface renderer (scene unit = pm)
  science/               units + scale bar, enclosed-probability threshold, CUBE writer
  state/atomic.ts        Atomic Explorer state, undo/redo, autosave
  components/            AtomicExplorer (workspace), PeriodicTable, ElementPanel,
                         SliceView (cross-sections + measurement), LineChart, EnergyDiagram,
                         Splitter (resizable panels), useLog (console)
  App.tsx                top toolbar and workspace switching
```

## Data flow

1. The UI requests element data and orbital models (`/api/elements/{sym}`, `/api/atoms/{sym}/orbital-models`).
2. Analytic orbitals are evaluated synchronously (`/api/hydrogenic/orbital`) and returned as
   base64 float32 volumes plus metadata (grid in pm, nodes, energies, thresholds).
3. SCF calculations are submitted to `/api/jobs/scf`. The job id is the hash of the settings, so
   identical requests return cached results. The worker writes `result.json` and a PySCF
   checkpoint; orbitals and ESP are evaluated from the checkpoint on demand.
4. The renderer uploads volumes as `Data3DTexture`s and ray-marches them in world coordinates (pm).

## Conventions

- Lengths: bohr inside quantum code, pm in anything sent to the UI, Å for user-entered
  coordinates (PySCF/ASE convention).
- Every property returned to the UI uses `prop(value, unit, source, method, conditions, notes)`
  (`api/atomic.py`); `value=None` means unavailable.
- Volumes are encoded with `encode_volume` (x varies fastest) and decoded with `decodeArray`.
- Expensive work goes through the job manager, never directly in a request handler.
- Each result states its method; the UI shows an "exact / approximation / computed" badge.
