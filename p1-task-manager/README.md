# P1 - Protecting a Node.js REST API with Cedarling

![Browser guidance and Fastify server enforcement with embedded Cedarling for task actions.](docs/assets/social-card.webp)

P1 is a multi-tenant task manager showing how Cedarling centralizes task
authorization inside a trusted Node.js API. Authentication, sessions, request
integrity, validation, tenant-scoped lists, and optimistic concurrency remain
application responsibilities.

The server enforces every protected task read and effect with Cedarling. The
browser evaluates the same policy release to hide controls conservatively,
while the server always makes the final decision.

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
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` prepares configuration and policies, starts this project's IdP,
and watches the browser and server together. Setup keeps the listen port aligned
with the registered application URL without resetting data.

For compiled startup, run `pnpm run setup`, `pnpm --dir ../shared/identity-provider build`,
and `pnpm build`. Keep `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js`
running in another terminal, then run `pnpm start`.
Setup, build, and development startup validate the readable `policy-store/` source and create the ignored
`.local/policy-store.cjar` archive used by the Cedarling integration.
After editing policies, restart `pnpm dev` or rebuild before `pnpm start`.
The policy store trusts only issuer `http://localhost:18001` and audience
`http://localhost:17001/api`; setup and startup reject different values.

## Exercise

The business workflow is a shared task board:

- **Alex** — Tenant A contributor who works assigned tasks.
- **Mina** — Tenant A owner who creates, assigns, edits, and deletes tasks.
- **Sam** — Tenant B external user who must remain isolated from Tenant A.

Compare their lists and mutations, including a direct task URL. The current
policy permits Alex to view and edit assigned Tenant A work, gives Mina the
owner actions in Tenant A, and isolates Sam's Tenant B work. Browser state
cannot grant an operation that the server denies.

## Commands

| Command          | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `pnpm run setup` | Create configuration and the local policy archive             |
| `pnpm dev`       | Start the IdP and watch the browser and server                |
| `pnpm start`     | Run the built server                                          |
| `pnpm reset`     | Restore synthetic local data                                  |
| `pnpm test:e2e`  | Build and test real browser/IdP authorization                 |
| `pnpm check`     | Run formatting, lint, types, tests, build, and browser checks |

## Verify

```bash
pnpm exec playwright install chromium
pnpm check
pnpm audit --audit-level low
```

On Linux, use `pnpm exec playwright install --with-deps chromium` if browser
system libraries are missing. Browser checks use temporary credentials and data;
stop this project's running instances first so its ports are free.
