# P1 - Protecting a Node.js REST API with Cedarling

P1 is a multi-tenant task manager showing how Cedarling centralizes task
authorization inside a trusted Node.js API. Authentication, sessions, request
integrity, validation, tenant-scoped lists, and optimistic concurrency remain
application responsibilities.

The marked task capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Alex / Mina / Sam ── sign in ──→ Tutorial IdP
        │
        └── task request ──→ React UI → Node.js API (PEP)
                                          │ principal + action + task + context
                                          ▼
                                     Cedarling PDP
                                      │        │
                                    DENY     ALLOW → Task service → SQLite
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x and pnpm 10.

The commands work from PowerShell, macOS terminals, and Ubuntu shells.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

Open <http://localhost:17001>. The issuer is <http://localhost:18001>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js
```

Keep the IdP running. In another terminal in this project directory:

```bash
pnpm dev
```

For `pnpm build` followed by `pnpm start`, first run `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js` in another terminal in this project directory.

## Exercise

The business workflow is a shared task board:

- **Alex** — Tenant A contributor who works assigned tasks.
- **Mina** — Tenant A owner who creates, assigns, edits, and deletes tasks.
- **Sam** — Tenant B external user who must remain isolated from Tenant A.

Compare their lists and mutations, including a direct task URL. The current
decision seam permits protected actions too broadly; Cedarling will decide each
task read and mutation from the actor, tenant, role, resource, and context.

## Commands

| Command          | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `pnpm run setup` | Create validated native configuration and fixtures |
| `pnpm dev`       | Build and watch the browser and server             |
| `pnpm start`     | Run the built server                               |
| `pnpm reset`     | Restore synthetic local data                       |
| `pnpm check`     | Run formatting, lint, types, tests, and build      |

## Verify

```bash
pnpm check
pnpm audit --audit-level low
```
