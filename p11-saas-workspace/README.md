# P11 - Securing Active-Tenant Switching in a SaaS Workspace with Cedarling

P11 is a SaaS project workspace shared by two organizations. It shows how
Cedarling centralizes authorization from current tenant, membership,
invitation, session, project, and support-approval facts.

The protected workspace capabilities currently use a fake permissive decision;
the Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Maya / Noah / Lena / Imani ── sign in ──→ Tutorial IdP
             │
             └── workspace request ──→ React Router Framework Mode
                                          │ typed loader or action (PEP)
                                          │ actor + current tenant/resource facts
                                          ▼
                                     Cedarling PDP
                                      │        │
                                    DENY     ALLOW → workspace effect → PostgreSQL
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24, pnpm 10, PostgreSQL, and the shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

## Run

```bash
docker compose up --build
```

Open <http://p11.localhost:3011>. For native development, `pnpm run setup`
starts PostgreSQL through Compose. Prepare and start the shared identity
provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P11:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow is a project workspace shared across organizations:

- **Maya** — Tenant A administrator and Tenant B viewer.
- **Noah** — Tenant A project editor without billing authority.
- **Lena** — Invitee with no membership until she accepts once.
- **Imani** — Support agent limited to one approved project.

Switch tenants, revoke membership, reuse an old tab, accept an invitation, and
redeem support access. The current seam over-trusts client context; Cedarling
will decide from current tenant, membership, project, invitation, and approval.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Validate configuration and initialize PostgreSQL |
| `pnpm dev` | Run the native IdP and Framework development server |
| `pnpm start` | Run the production Framework build |
| `pnpm reset` | Restore deterministic PostgreSQL fixtures |
| `pnpm admin` | Apply tutorial administration changes |
| `pnpm test:e2e` | Verify the Docker-backed browser workflow and restart persistence |
| `pnpm check` | Run formatting, lint, types, unit tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
docker compose config
```
