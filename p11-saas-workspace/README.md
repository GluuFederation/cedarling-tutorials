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
- Node.js 24.21 or newer within 24.x, pnpm 10, PostgreSQL, and the project-local tutorial identity provider.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

Open <http://localhost:17011>. The issuer is <http://localhost:18011>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm dev` starts this project’s IdP and application together.

Setup starts PostgreSQL through Compose for the default database URL,
`postgresql://p11:p11@127.0.0.1:5435/p11`. For a Docker-free stack, create a local
PostgreSQL database and set a different `P11_DATABASE_URL` in `.env` before setup.
A shell value takes precedence over `.env`; setup saves the selected URL for
later commands. Custom databases are used directly, without starting Docker.

For `pnpm build` followed by `pnpm start`, first run `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js` in another terminal in this project directory.

Use `pnpm dev -- --reset` only when you want to restore the tutorial fixtures.

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
```
