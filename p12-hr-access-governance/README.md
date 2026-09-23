# P12 - Governing Employee Record Access with Cedarling

P12 is an HR workflow where administrators request employee-specific contact
access, reviewers approve it, managers use it, and authorized staff revoke it.
It shows how Cedarling centralizes separation of duties, grant state, and
field-level authorization.

The protected HR capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Lin / Nia / Ben ── sign in ──→ Tutorial IdP
       │
       └── employee / grant request ──→ React UI → Node.js API (PEP)
                                                     │ actor + employee + grant facts
                                                     ▼
                                                Cedarling PDP
                                                 │        │
                                               DENY     ALLOW → HR effect → SQLite
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

Open <http://p12.localhost:3012>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P12:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow grants temporary access to employee records:

- **Lin** — HR administrator and reviewer who requests access for an employee.
- **Nia** — Independent reviewer who approves or revokes requests.
- **Ben** — Manager who reads his employees' permitted record fields.

Select Cora, request access, review it, then revoke it and read again. The
current seam permits self-approval and contact reads without a current grant;
Cedarling will enforce separation, employee scope, and grant effectiveness.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Validate configuration and initialize SQLite |
| `pnpm dev` | Build the browser and watch the app |
| `pnpm start` | Run the built app |
| `pnpm test:e2e` | Exercise the HR grant lifecycle |
| `pnpm check` | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
docker compose config
```
