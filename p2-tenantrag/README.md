# P2 - Preventing Cross-Tenant RAG Data Leaks with Cedarling

P2 is a headless retrieval service that turns synthetic PDFs into answers. It
shows how Cedarling centralizes authorization at corpus search and protected
chunk access without mixing policy decisions with retrieval or generation.

The two protected retrieval capabilities currently use a fake permissive
decision; the Cedarling tutorial replaces that seam with policy-backed
decisions.

## Architecture

```text
Ada / Leo / Mallory ── Device Flow ──→ Tutorial IdP
          │
          └── retrieval request ──→ Node.js API (PEP)
                                         │ principal + corpus + document
                                         ▼
                              Fake permissive decision
                                         │
                                       ALLOW → Orama → OpenRouter
                                                       ↑
                                    PDFs → PDF.js → Voyage embeddings
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or Node.js 24.21 or newer within 24.x and pnpm 10.
- Voyage AI and OpenRouter API keys.
- This project's tutorial identity provider, started below for native use.

## Run

Set `P2_VOYAGE_API_KEY` and `P2_OPENROUTER_API_KEY` in `.env` before preparing the corpus or starting Docker.
Setup embeds synthetic PDF chunks with Voyage and checks OpenRouter generation; requests also consume provider quota. Do not submit private queries.

Start the application and its own IdP:

```bash
docker compose up --build
```

API: <http://localhost:17002>. The issuer is <http://localhost:18002>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js
```

Keep the IdP running. In another terminal in this project directory:

```bash
pnpm dev
```

For `pnpm build` followed by `pnpm start`, first run `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js` in another terminal in this project directory.
After changing the PDFs, run `pnpm corpus:reset` and restart; startup rejects an index built from different document content.
For Docker, rebuild the `tenantrag` image, start its IdP, run the reset in a one-off container, then start the stack:

```bash
docker compose build tenantrag
docker compose up -d identity-provider
docker compose run --rm --no-deps tenantrag node --env-file=/run/config/app.env dist/scripts/corpus-reset.js
docker compose up --build
```

## Exercise

The business workflow answers support questions from tenant-owned documents:

- **Ada (`ada`)** — Tenant A analyst with confidential-document access.
- **Leo (`leo`)** — Partner reviewer limited to Tenant A public evidence.
- **Mallory (`mallory`)** — Tenant B analyst with no Tenant A access.

Run `pnpm auth <persona>`, complete device sign-in, and use the printed access token:

```http
POST http://localhost:17002/v1/retrievals
Authorization: Bearer <access-token>
Content-Type: application/json

{"corpusId":"tenant-a-support","query":"What happened during Aster's support-search interruption?","limit":3}
```

The current decision
seam can send cross-tenant or over-classified chunks to the model; Cedarling
will authorize both corpus search and each document before text is loaded.
Match a failed response's `requestId` to the structured `retrieval.failed` log;
`stage` identifies the failing step and provider details distinguish availability
failures from an authorization decision. Live provider output can vary.

## Commands

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `pnpm run setup`    | Validate configuration and prepare the corpus |
| `pnpm auth`         | Authenticate a tutorial persona               |
| `pnpm corpus:reset` | Rebuild the deterministic vector corpus       |
| `pnpm dev`          | Watch the native service                      |
| `pnpm start`        | Run the built service                         |
| `pnpm test:e2e`     | Exercise the live retrieval boundaries        |
| `pnpm check`        | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm audit --audit-level low
```
