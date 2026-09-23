# P8 - Securing File Sharing and Blocking Path Traversal with Cedarling

P8 is a virtual file workspace showing how Cedarling centralizes file and share
authorization while the application separately guarantees filesystem safety.
SQLite stores stable resource identities; opaque filenames contain content
under a private root.

The protected file capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Jordan / Priya / Lee ── sign in ──→ Tutorial IdP
          │
          └── file request ──→ React explorer → Node.js API (PEP)
                                                   │ principal + resource + share facts
                                                   ▼
                                              Cedarling PDP
                                               │        │
                                             DENY     ALLOW → SQLite metadata
                                                                └→ contained file effect
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

Open <http://p8.localhost:3008>. For native development, prepare and start the
shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P8:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

## Exercise

The business workflow is a shared virtual file workspace:

- **Jordan** — Workspace A owner who manages files and shares.
- **Priya** — Editor of Jordan's shared folder.
- **Lee** — Workspace B viewer without Workspace A ownership.

Browse, upload, preview, edit, share, and delete; then try a viewer write,
editor reshare, and cross-workspace ID. The current seam permits overreach;
Cedarling will decide each resource action while path containment stays native.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Validate configuration and initialize storage |
| `pnpm dev` | Build the browser and watch the server |
| `pnpm start` | Run the built server |
| `pnpm reset` | Restore synthetic storage |
| `pnpm test:e2e` | Verify the Docker-backed file workflow |
| `pnpm check` | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
docker compose config
```
