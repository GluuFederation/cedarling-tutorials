# P7 - Securing Real-Time Collaborative Documents with Cedarling

CedarDocs is a focused collaborative-document application for learning how
Cedarling protects reads, edits, comments, sharing, and live-update delivery.
The protected collaboration capabilities currently use a fake permissive
decision; the Cedarling tutorial replaces that seam with policy-backed
decisions.

## Architecture

```text
Browser (React)
  │ Authorization Code + PKCE session
  ▼
Fastify BFF ──► shared local OpenID Provider
  │
  ├─► Cedarling authorization
  │     principal + capability + current document/membership facts
  │
  ├─► SQLite transactions
  │     documents + memberships + comments + versions
  │
  └─► protected SSE stream
        invalidation metadata only; browser refetches through Cedarling
```

The BFF owns the session cookie and every authoritative effect. Document and
access versions close write races, comment keys make retries idempotent, and
the owner relationship remains immutable outside policy evaluation.

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x, pnpm 10, and the project-local tutorial identity provider.

The commands work from PowerShell, macOS terminals, and Ubuntu shells.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

Open <http://localhost:17007>. The issuer is <http://localhost:18007>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm dev` starts this project’s IdP and application together.

For `pnpm build` followed by `pnpm start`, first run `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js` in another terminal in this project directory.

Use `pnpm dev -- --reset` only when you want to restore the tutorial fixtures.

## Exercise

- **Maya Chen** (`maya`) owns the launch brief and a private planning document.
- **Noah Williams** (`noah`) edits the launch brief.
- **Lena Ortiz** (`lena`) comments on the launch brief.

Use any non-empty password. Compare these business failures before integrating
Cedarling:

1. Noah can open Maya's private planning document without membership.
2. Lena can edit the launch brief despite being a commenter.
3. Noah can change or remove another collaborator's access despite not owning
   the document.
4. Maya can revoke Noah while he has the document open, yet Noah's stream keeps
   receiving invalidations and his refetch still returns the document.

Create another document as any persona to confirm that its creator becomes the
immutable owner. Open the same document in two browser contexts to observe SSE
invalidation, explicit refetch, and stale-version handling.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Synchronize the IdP registration and prepare SQLite |
| `pnpm dev` | Run the complete native development stack |
| `pnpm start` | Run the previously built application |
| `pnpm reset` | Restore deterministic collaboration fixtures |
| `pnpm test:e2e` | Exercise the browser collaboration workflow |
| `pnpm check` | Run formatting, lint, types, tests, build, and browser checks |

## Verify

```bash
pnpm check
pnpm audit --audit-level low
```

The browser receives only document IDs and event kinds over SSE. All document
content is loaded again through the authenticated and authorized HTTP boundary.
