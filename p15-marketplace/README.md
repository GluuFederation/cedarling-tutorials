# P15 - Authorizing a Multi-Party Marketplace Refund with Cedarling

P15 is a marketplace workflow that follows one purchase and refund across buyer,
seller, support, and fraud views. It shows how Cedarling centralizes
relationship-specific projections, seller boundaries, approval limits, and
refund actions while the application preserves lifecycle integrity.

The protected marketplace capabilities currently use a fake permissive
decision; the Cedarling tutorial replaces that seam with policy-backed
decisions.

## Architecture

```text
Bao / Sela / Diego / Nia ── sign in ──→ Tutorial IdP
            │
            └── order / refund request ──→ React UI → Node.js API (PEP)
                                                       │ actor + relationship + case facts
                                                       ▼
                                                  Cedarling PDP
                                                   │        │
                                                 DENY     ALLOW → marketplace effect → SQLite
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x, pnpm 10, and the project-local tutorial identity provider.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

Open <http://localhost:17015>. The issuer is <http://localhost:18015>. Stop the stack with `Ctrl+C`, then `docker compose down`.

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

The business workflow resolves a marketplace refund across four parties:

- **Bao** — Buyer who places an order and requests its refund.
- **Sela** — Seller who reviews refunds for Sela Books.
- **Diego** — Support agent who approves assigned refunds within his limit.
- **Nia** — Fraud reviewer who handles escalated approvals.

Try actions from the wrong relationship and exceed approval limits. The current
seam permits overreach; Cedarling will authorize every projection and action
while the application preserves versioned transitions and one refund effect.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Validate configuration and initialize marketplace data |
| `pnpm dev` | Build the browser and watch the app |
| `pnpm start` | Run the built app |
| `pnpm test:e2e` | Exercise the purchase and refund lifecycle |
| `pnpm check` | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
```
