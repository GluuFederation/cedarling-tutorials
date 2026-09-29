# P3 - Authorizing MCP Incident Operations with Cedarling

P3 is a terminal assistant for searching incidents, reading a runbook, preparing
triage, and updating incident status through MCP. It shows how Cedarling
centralizes authorization for tools, resources, and prompts at the MCP server.

The protected MCP capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Dana / Amir / Eve ── Device Flow ──→ Tutorial IdP
        │
        └── terminal chat → OpenRouter → MCP client → MCP server (PEP)
                                                     │ caller + action + resource
                                                     ▼
                                                Cedarling PDP
                                                 │        │
                                               DENY     ALLOW → incidents / runbook / triage
```

## Prerequisites

- Node.js 24.21 or newer within 24.x and pnpm 10 on Ubuntu, macOS, or Windows.
- Docker Desktop or Docker Engine with Compose when using Docker startup.
- The project-local tutorial identity provider (started below).
- An OpenRouter API key in `P3_OPENROUTER_API_KEY` for interactive chat.

## Run

Start the application and its own IdP:

```bash
docker compose up --build
```

MCP endpoint: <http://localhost:17003/mcp>. The issuer is <http://localhost:18003>. Stop the stack with `Ctrl+C`, then `docker compose down`.

For native development, run from this project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm dev` starts this project’s IdP and application together.

For interactive chat, install the project dependencies on the host, set `P3_OPENROUTER_API_KEY` in its `.env`, and run `pnpm chat dana` in another terminal. This client works with either the native or Docker service.

For `pnpm build` followed by `pnpm start`, first run `node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js` in another terminal in this project directory.

## Exercise

The intended responsibilities are:

- **Dana (`dana`)** — Incident supervisor responsible for all incidents.
- **Amir (`amir`)** — Analyst responsible for assigned incidents.
- **Eve (`eve`)** — Authenticated caller without incident authority.

Run `pnpm chat <persona>` and send one request at a time:

1. As Amir, ask to find the payment incident (`INC-1001`), read the runbook,
   and obtain its triage guidance.
2. Ask to advance `INC-1001` from `open` to `investigating`. Confirm the
   change when prompted; declining leaves it unchanged.
3. As Dana, find the unassigned audit incident (`INC-2001`).
4. As Eve or Amir, find that same incident and request a valid next status.
   Both callers currently succeed despite lacking the intended authority.

Cedarling will restrict discovery and enforce authorization again before each
server operation. Host confirmation protects against accidental changes; it
does not replace server authorization. Statuses advance through `open` →
`investigating` → `mitigated` → `resolved`. Restart P3 to restore the fixtures.

`pnpm test:e2e` runs these paths with a scripted model, without an OpenRouter key.

## Commands

| Command               | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `pnpm run setup`      | Validate native configuration                 |
| `pnpm dev`            | Start the MCP service for development         |
| `pnpm chat <persona>` | Start the terminal learner experience         |
| `pnpm start`          | Run the built service                         |
| `pnpm test:e2e`       | Run deterministic end-to-end tool scenarios   |
| `pnpm check`          | Run formatting, lint, types, tests, and build |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
```
