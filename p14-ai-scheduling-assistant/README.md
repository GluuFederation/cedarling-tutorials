# P14 - Governing an AI Scheduling Assistant with Cedarling

P14 is a workplace scheduling assistant where a deterministic simulator
proposes bounded tool intent and a trusted Node.js gateway authorizes the exact
scheduling effect from the signed-in user, current meeting, room, and
delegation facts. The simulator keeps the tutorial reproducible; a production
model would replace only that intent-producing component.

The marked scheduling capabilities currently use a fake permissive decision;
the Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Dina / Amara / Benoit / Chloe ── sign in ──→ Tutorial IdP
                 │
                 └── predefined request ──→ React UI → intent simulator
                                                           │ untrusted intent
                                                           ▼
                                              Fastify tool gateway (PEP)
                                                           │ resolves current IDs,
                                                           │ versions, relationships
                                                           ▼
                                                     Cedarling PDP
                                                      │        │
                                                    DENY     ALLOW
                                                               │
                                                               ▼
                                                conditional SQLite effect
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24, pnpm 10, and the shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

The commands work from PowerShell, macOS terminals, and Ubuntu shells.

## Run

Start the complete isolated stack:

```bash
docker compose up --build
```

Open <http://p14.localhost:3014>. For native development, install both dependency
sets once:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` prepares, builds, and supervises both the shared identity provider
and P14. Ports 4000 and 3014 must be free.

## Exercise

The business workflow is a scheduling assistant that turns predefined requests
into inert proposals and performs an effect only after explicit confirmation:

- **Dina** — Project lead who organizes meetings and uses employee rooms.
- **Amara** — Coordinator with one active and one revoked meeting delegation.
- **Benoit** — Attendee who may read relevant meetings but not reschedule them.
- **Chloe** — Contractor who may use visitor-safe rooms, not employee rooms.

Use the displayed requests to list availability, schedule, reschedule, or
cancel a meeting. The simulator contributes only resource names and intent;
the server resolves current resource IDs, versions, and relationships. The
current decision seam permits an attendee reschedule, an employee-room
contractor booking, and a revoked-delegation cancellation; Cedarling will
decide each effect from those current trusted facts.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Create validated configuration and SQLite fixtures |
| `pnpm dev` | Build and supervise the IdP and watched application |
| `pnpm start` | Run the built application |
| `pnpm reset` | Restore the scheduling fixtures |
| `pnpm test:e2e` | Exercise the browser scheduling workflow |
| `pnpm check` | Run formatting, lint, types, tests, build, and browser checks |

## Verify

```bash
pnpm check
pnpm audit --audit-level low
docker compose config
```
