# P6 - Reauthorizing Offline Field Inspections with Cedarling

P6 is a field-service inspection console showing how Cedarling reauthorizes an
offline action when it returns to a trusted Node.js server. The browser may use
cached policy context to guide a technician, while the server remains the
authority for every work-order read, creation, deletion, reassignment, and
inspection commit.

The marked capabilities currently use fake permissive decisions; the Cedarling
tutorial replaces those seams with browser preflight and authoritative server
decisions.

## Architecture

```text
Elena / Malik / Rowan ── sign in ──→ Tutorial IdP
          │
          └── work-order request ──→ React field console
                                        │ local draft + advisory preflight
                                        ▼
                                   Browser Cedarling
                                        │ reconnect
                                        ▼
                                  Node.js API (PEP)
                                        │ current principal + assignment + version
                                        ▼
                                   Server Cedarling
                                     │        │
                                   DENY     ALLOW → conditional SQLite effect
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x, pnpm 10, and a running shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

The commands work from PowerShell, macOS terminals, and Ubuntu shells.

## Run

The complete stack starts with:

```bash
docker compose up --build
```

Open <http://p6.localhost:3006>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P6:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow is an inspection queue used during unreliable field
connectivity:

- **Elena** — technician initially assigned to Cooling pump 17 at North Plant.
- **Malik** — technician assigned to Backup generator 04 and the reassignment
  target for Elena's work order.
- **Rowan** — field supervisor responsible for changing technician assignments.

The queue starts with six work orders split between Elena and Malik. Use the
compact add control to create another assigned order, and delete an open order
from its detail panel. The current interface exposes those two supervisor
operations to every persona so their authorization boundaries remain easy to
exercise.

Use two independent browser profiles. As Elena, open Cooling pump 17, go
offline, complete the checklist, and queue the inspection. As Rowan in the
second profile, reassign that work order to Malik. Reconnect Elena and retry the
queued submission.

The current decision seams permit five protected outcomes too broadly: Elena
can read Malik's work order; create, delete, and reassign work orders reserved
for Rowan; and complete a queued inspection after Rowan assigns the work to
Malik. Cedarling will restrict browser affordances and independently recheck
the current principal, assignment, status, and versions at the server before
any effect.

## Commands

| Command          | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `pnpm run setup` | Create validated native configuration and SQLite fixtures |
| `pnpm dev`       | Build dependencies and run the watched native stack       |
| `pnpm start`     | Run the built application                                 |
| `pnpm reset`     | Restore deterministic field-inspection fixtures           |
| `pnpm test:e2e`  | Exercise the browser login and offline draft lifecycle     |
| `pnpm check`     | Run formatting, lint, types, tests, build, and browser test |

## Verify

Install Chromium once before the complete local check:

```bash
pnpm exec playwright install chromium
pnpm check
pnpm audit --audit-level low
docker compose config
```
