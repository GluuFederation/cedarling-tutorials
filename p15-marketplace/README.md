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
- Node.js 24.21 or newer within 24.x, pnpm 10, and the shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

## Run

```bash
docker compose up --build
```

Open <http://p15.localhost:3015>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P15:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

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
docker compose config
```
