# Security model

Chemical Modelling is a single-user local application. The backend listens on
`127.0.0.1:8000` and has no authentication, so its protections are aimed at the two ways
something other than the user can still reach it: web pages open in the user's browser, and
hostile input (opened project files, pasted structures, crafted requests).

## Network exposure

| Protection | Where | Why |
|---|---|---|
| Bind to `127.0.0.1` only | `scripts/start-backend.sh` | Not reachable from the LAN. Do not change to `0.0.0.0`. |
| `Host` header allow-list (`localhost`, `127.0.0.1`, `::1`) | `api/main.py`, `TrustedHostMiddleware` | Blocks DNS rebinding, where a page on an attacker's domain re-resolves it to 127.0.0.1 and becomes "same-origin" with the API. |
| CORS limited to the Vite dev server origins | `api/main.py` | Other sites cannot read API responses or send JSON requests. |
| `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, COOP | `api/main.py` | The UI cannot be framed (clickjacking) and responses are not content-sniffed. |

Extra hosts or origins (for example a desktop shell that loads the UI from a custom scheme)
are added with comma-separated environment variables, never by widening the defaults:

- `CHEMMODEL_ALLOWED_HOSTS` – additional `Host` names (the test suite adds `testserver`).
- `CHEMMODEL_CORS_ORIGINS` – additional browser origins, e.g. `tauri://localhost`.

## Resource limits

Every request is bounded so a single request (or a burst of them) cannot hang or exhaust
the machine:

- At most `CHEMMODEL_MAX_JOBS` (default 4) calculations run at once; more get HTTP 429.
- Quantum jobs: ≤ 500 atoms, finite coordinates, allow-listed basis sets and functionals,
  `max_cycle` ≤ 1000, `1e-14 ≤ conv_tol ≤ 1e-3`, grid ≤ 128³.
- SMILES: ≤ 1000 characters and ≤ 500 atoms after adding hydrogens.
- Crystals: ≤ 20 000 atoms (checked with Python integers, so huge repeat counts cannot
  overflow past the check), lattice-plane spacing ≥ 0.5 Å (a nearly flat cell made the
  periodic neighbour search effectively infinite), bounded neighbour-list size, user bases
  ≤ 100 sites before space-group expansion.
- Hydrogen-like orbitals: ≤ 10 enclosed-probability fractions, malformed lists give 422.

## Job ids and the cache

Job ids are 24-character hex digests. The backend refuses any other id before it is used as
a directory name under `~/.chemmodel/cache`, and the frontend refuses to put any other id
from an opened project file into a request URL.

## Dependencies

`npm audit` (frontend) and `pip-audit -r backend/requirements.txt` (backend) report no known
vulnerabilities as of 2026-11-07. Starlette is required at ≥ 0.49.1 for the Range-header
denial-of-service fix in `StaticFiles` (CVE-2025-62727), which serves the built UI.

Run both audits before each release.
