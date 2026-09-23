# P5 - Protecting Sensitive Fields and Data Exports with Cedarling

P5 is a workforce analytics application that compiles a bounded query plan to
parameterized SQLite and creates expiring CSV exports. It shows how Cedarling
centralizes independent authorization for rows, fields, aggregates, export
creation, and downloads.

The protected data capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Amina / Leah / Theo ── sign in ──→ Tutorial IdP
         │
         └── data request ──→ React UI → Node.js + Hono API (PEP)
                                            │ principal + query/export facts
                                            ▼
                                       Cedarling PDP
                                        │        │
                                      DENY     ALLOW → query compiler → SQLite / CSV
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x, pnpm 10, and the shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

## Run

```bash
docker compose up --build
```

Open <http://p5.localhost:3005>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P5:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow explores workforce analytics and exports:

- **Amina** — Tenant A support analyst with limited data needs.
- **Leah** — Tenant A finance lead who needs compensation data.
- **Theo** — Tenant B external reviewer who must remain isolated.

Query fields and aggregates, create an export, and try another user's download.
The current seam permits protected data effects broadly; Cedarling will decide
rows, fields, aggregates, export creation, and each download independently.

## Commands

| Command          | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `pnpm run setup` | Validate configuration and initialize fixtures |
| `pnpm dev`       | Build and watch the complete local Node stack |
| `pnpm start`     | Run the application                            |
| `pnpm reset`     | Restore synthetic data                         |
| `pnpm test:e2e`  | Exercise data and export boundaries            |
| `pnpm check`     | Run formatting, lint, types, tests, and build  |

## Verify

```bash
pnpm check
pnpm audit --audit-level low
docker compose config
```
