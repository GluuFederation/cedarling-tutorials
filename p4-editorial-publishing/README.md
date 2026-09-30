# P4 - Securing Editorial Publishing with Cedarling

CedarPress is a focused editorial workspace where authors submit immutable
revisions, editors review exact content, and publishers release a revision only
while its approval evidence and reviewer authority remain current.

The marked editorial capabilities currently use a focused fake decision that
preserves normal ownership and tenant checks while leaving three approval and
publication gaps for the Cedarling tutorial.

## Architecture

```text
Riley / Ana / Omar ── sign in ──→ Tutorial IdP
         │
         └── article and revision forms ──→ Next.js App Router
                                                   │
                                      Server Component / Action
                                                   │
                                                   ▼
                                        Fake decision seam
                                              │        │
                                            DENY     ALLOW
                                                       │
                                                       ▼
                                          conditional SQLite effect
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or
- Node.js 24.21 or newer within 24.x, pnpm 10, and the project-local tutorial identity provider.

The commands work from PowerShell, macOS terminals, and Ubuntu shells.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

Open <http://localhost:17004>. The issuer is <http://localhost:18004>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm dev` starts this project’s IdP and application together.

`pnpm build` followed by `pnpm start` runs the compiled application stack and its project IdP.

Use `pnpm dev -- --reset` only when you want to restore the tutorial fixtures.

## Exercise

The workflow demonstrates why an earlier editorial decision is not standing
authority for later publication:

- **Riley** — Author who drafts and submits articles but has no review authority.
- **Ana** — Editor and publisher for the valid review and publication path.
- **Omar** — Editor whose seeded authority can be revoked after approval.

Use **Launch brief** to submit and self-approve as Riley. Reset, approve
**Customer migration guide** revision 1 as Ana, sign in as Riley to create and
submit revision 2, then sign in as Ana and publish the unapproved revision.
Reset again, approve **Partner announcement** as Omar, revoke his authority,
then publish as Ana:

```bash
pnpm admin revoke-omar
```

For Docker, run the equivalent command against the running application:

```bash
docker compose exec cedarpress node --env-file=/run/config/app.env scripts/admin.ts revoke-omar
```

The current decision seam permits self-review, approval reuse across revisions,
and publication after reviewer revocation. Cedarling will decide each effect
from the exact current revision, digest, approval, and authority facts.

Riley can also choose **New article** to create a tenant-scoped draft, then
submit it through the same review workflow. The fake `article.create` seam
allows this baseline action for signed-in users; the Server Action still
checks the session, CSRF token, and draft input before insertion.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run setup` | Prepare project identity configuration and SQLite fixtures |
| `pnpm dev` | Prepare and supervise the IdP and Next.js development server |
| `pnpm start` | Prepare and supervise the IdP and production build |
| `pnpm reset` | Restore deterministic editorial fixtures |
| `pnpm admin revoke-omar` | Revoke Omar's seeded editor authority |
| `pnpm test:e2e` | Exercise the real browser and IdP workflow |
| `pnpm check` | Run formatting, lint, types, tests, build, and browser checks |

## Verify

```bash
pnpm check
pnpm audit --audit-level low
```
