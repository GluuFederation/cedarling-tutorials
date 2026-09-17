# P9 - Securing Realtime Chat Rooms and Events with Cedarling

P9 is a multi-tenant realtime chat application showing how Cedarling
centralizes current authorization for room entry, message replay, delivery,
moderation, and reconnects beyond a Socket.IO subscription.

The protected realtime capabilities currently use a fake permissive decision;
the Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Mei / Kwame / Yuki ── sign in ──→ Tutorial IdP
         │
         └── HTTP / Socket.IO event ──→ Express gateway (PEP)
                                             │ principal + room + event facts
                                             ▼
                                        Cedarling PDP
                                         │        │
                                       DENY     ALLOW → room delivery / SQLite
                                                          ↑
                                              one-use tickets + bounded replay
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24, pnpm 10, and the shared tutorial identity provider.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

## Run

```bash
docker compose up --build
```

Open <http://p9.localhost:3009>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P9:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow is a tenant chat with live membership changes:

- **Mei** — Tenant A general-room member.
- **Kwame** — Tenant A moderator for general and restricted rooms.
- **Yuki** — Member removed while an existing socket remains connected.

Use separate browser profiles, remove Yuki, reconnect, enter a restricted room,
and try moderation as a member. The current seam treats transport state as
authority; Cedarling will re-evaluate room and event access at every boundary.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Validate configuration and initialize chat data |
| `pnpm dev` | Build the browser and watch the server |
| `pnpm start` | Run the built server |
| `pnpm reset` | Restore synthetic chat data |
| `pnpm test:e2e` | Verify the Docker-backed realtime workflow |
| `pnpm check` | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
docker compose config
```
