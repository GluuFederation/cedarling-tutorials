# P10 - Authorizing Warehouse Workloads with Cedarling

P10 is a warehouse stock-transfer console for learning how Cedarling authorizes
OAuth Client Credentials workloads. A signed machine token proves which
workload is calling; authorization decides whether that workload may plan,
release, receive, or inspect a transfer in its current state.

The marked capabilities currently use compact fake permissive decisions. The
Cedarling tutorial replaces that adapter while preserving every business and
authentication boundary.

## Architecture

```text
React workload console
  │ fixed workload action
  ▼
Console BFF ── private credential ──► Workload agent ── Client Credentials ──► IdP
                                             │ signed access token
                                             ▼
                                      Warehouse API (PEP)
                                             │ principal + current SQLite facts
                                             ▼
                                         Cedarling
                                          │     │
                                        DENY  ALLOW ──► conditional SQLite effect
```

The browser never receives a client secret or workload token. Four isolated
agent processes each own one credential. The Warehouse API verifies the token,
loads current transfer and inventory facts, marks the authorization boundary,
and only then attempts a versioned SQLite transaction.

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x, pnpm 10, and the shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

The commands work from PowerShell, macOS terminals, and Ubuntu shells.

## Run

Start the complete isolated stack:

```bash
docker compose up --build
```

Open <http://p10.localhost:3010>.

For native development, install this project and the shared identity provider:

```bash
pnpm install --frozen-lockfile
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm dev
```

`pnpm dev` prepares configuration, builds both applications, and supervises the
identity provider, Warehouse API, four workload agents, and React console.

## Exercise

The workflow moves three allowlisted products between North and South
warehouses:

- **Transfer Planner** — creates and inspects planned transfers.
- **North Warehouse** — releases North stock and receives North deliveries.
- **South Warehouse** — releases South stock and receives South deliveries.
- **Inventory Auditor** — reads inventory without changing transfers.

Create a North-to-South transfer as Planner. Release it as North, receive it as
South, and confirm that stock moves exactly once at each transition. Then use
the secondary actions to reproduce the three authorization problems:

- Auditor creates a transfer despite being read-only.
- South releases stock owned by North.
- North receives stock destined for South.

Cedarling will deny those three operations from the same authenticated
workloads while retaining the valid Planner, source-warehouse,
destination-warehouse, and Auditor reads.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Synchronize workload credentials and initialize SQLite |
| `pnpm dev` | Build and run the watched native stack |
| `pnpm start` | Build and run the production-mode native stack |
| `pnpm reset` | Restore deterministic inventory and transfer fixtures |
| `pnpm test:e2e` | Exercise the workload console in Chromium |
| `pnpm check` | Run formatting, lint, types, tests, build, and browser checks |

## Verify

Install Chromium once before the complete local check:

```bash
pnpm exec playwright install chromium
pnpm check
pnpm audit --audit-level low
docker compose config
```
