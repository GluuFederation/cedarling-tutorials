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
                                    Cedarling PDP
                                     │        │
                                   DENY     ALLOW → Orama → OpenRouter
                                                       ↑
                                    PDFs → PDF.js → Voyage embeddings
```

## Prerequisites

- Docker Desktop or Docker Engine with Compose, or Node.js 24.21 or newer within 24.x and pnpm 10.
- Voyage AI and OpenRouter API keys.
- This project's tutorial identity provider, started below for native use.

## Run

Set `P2_VOYAGE_API_KEY` and `P2_OPENROUTER_API_KEY` in `.env` before preparing the corpus or starting Docker.

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

## Exercise

The business workflow answers support questions from tenant-owned documents:

- **Ada (`ada`)** — Tenant A analyst with confidential-document access.
- **Leo (`leo`)** — Partner reviewer limited to Tenant A public evidence.
- **Mallory (`mallory`)** — Tenant B analyst with no Tenant A access.

Run `pnpm auth <persona>` and call `POST /v1/retrievals`. The current decision
seam can send cross-tenant or over-classified chunks to the model; Cedarling
will authorize both corpus search and each document before text is loaded.

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
