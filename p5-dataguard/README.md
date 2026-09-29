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
- Node.js 24.21 or newer within 24.x, pnpm 10, and the project-local tutorial identity provider.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

Open <http://localhost:17005>. The issuer is <http://localhost:18005>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm dev` starts this project’s IdP and application together.

For `pnpm build` followed by `pnpm start`, first run `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js` in another terminal in this project directory.

Use `pnpm dev -- --reset` only when you want to restore the tutorial fixtures.

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
```
