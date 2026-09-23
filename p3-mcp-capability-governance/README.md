# P3 - Cataloging and Authorizing MCP Capabilities with Cedarling

P3 is a terminal incident-operations assistant with an authenticated MCP client,
a reviewed capability catalog, and bounded synthetic tools. It shows how
Cedarling centralizes the decision about who may use each discovered capability
on a particular resource.

The protected MCP capabilities currently use a fake permissive decision; the
Cedarling tutorial replaces that seam with policy-backed decisions.

## Architecture

```text
Dana / Amir / Eve ── Device Flow ──→ Tutorial IdP
        │
        └── terminal chat → OpenRouter → MCP client → MCP server (PEP)
                                                     │ principal + capability + resource
                                                     ▼
                                                Cedarling PDP
                                                 │        │
                                               DENY     ALLOW → GovOps tools and resources
                                                                  ↑
                                                         ACC capability catalog
```

## Prerequisites

- Node.js 24.21 or newer within 24.x and pnpm 10 on Ubuntu, macOS, or Windows.
- A running shared tutorial identity provider.
- An OpenRouter API key for interactive model-driven chat.
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

Keep the service terminal open. In another terminal, run:

```bash
pnpm chat dana
```

## Exercise

The business workflow is an incident-operations assistant:

- **Dana (`dana`)** — Capability-catalog maintainer who reconciles discovery.
- **Amir (`amir`)** — Incident analyst assigned approved operational work.
- **Eve (`eve`)** — Authenticated caller without approved incident authority.

Run `pnpm chat <persona>`, discover the catalog, read the runbook, inspect an
incident, and try a mutation. The current seam accepts every mapped persona;
Cedarling will authorize each MCP capability against its principal and resource.

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
