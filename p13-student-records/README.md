# P13 - Protecting Grade Publication and Guardian Access with Cedarling

P13 is a school records workflow where a teacher publishes a grade and a
student and guardian receive different projections. It shows how Cedarling
centralizes authorization for drafts, publication, student reads, and narrower
guardian reads.

The protected record capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Talia / Sam / Grace ── sign in ──→ Tutorial IdP
         │
         └── grade request ──→ React UI → Node.js API (PEP)
                                             │ actor + class + student + record facts
                                             ▼
                                        Cedarling PDP
                                         │        │
                                       DENY     ALLOW → grade effect → SQLite
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

Open <http://p13.localhost:3013>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P13:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow publishes school grades to families:

- **Talia** — Algebra teacher who drafts and publishes current-course grades.
- **Sam** — Student who reads only his published result.
- **Grace** — Guardian who reads Sam's smaller projection while linked.

Try another teacher's draft, a cross-student read, guardian overreach, and a
stale publication. The current seam permits these protected actions; Cedarling
will authorize each draft, publication, student projection, and guardian view.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Validate configuration and initialize SQLite |
| `pnpm fixture` | Restore the deterministic learner fixture |
| `pnpm dev` | Build the browser and watch the app |
| `pnpm start` | Run the built app |
| `pnpm test:e2e` | Exercise publication and projection boundaries |
| `pnpm check` | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
docker compose config
```
