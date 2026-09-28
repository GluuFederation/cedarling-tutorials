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
- A running shared tutorial identity provider.
- An OpenRouter API key in `P3_OPENROUTER_API_KEY` for interactive chat.
- On Windows, run `node ../shared/host check`; if it fails, run
  `node ../shared/host install` from an elevated terminal.

P3 does not include Docker Compose because the learner operates its terminal
client and local MCP service directly. The commands support Ubuntu, macOS, and
Windows terminals.

## Run

Prepare and start the shared identity provider first:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider run setup
pnpm --dir ../shared/identity-provider dev
```

Then, in another terminal, prepare and start P3:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

Set `P3_OPENROUTER_API_KEY` in P3's generated `.env`. Keep the service terminal
open and, in another terminal, run:

```bash
pnpm chat dana
```

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
