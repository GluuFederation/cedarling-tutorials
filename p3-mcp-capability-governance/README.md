# P3 - Authorizing MCP Incident Operations with Cedarling

![An MCP server checks incident capabilities with a private Cedarling sidecar before protected effects.](docs/assets/social-card.webp)

P3 is a terminal assistant for searching incidents, reading a runbook, preparing
triage, and updating incident status through MCP. Cedarling centralizes decisions
for tools, resources, and prompts; the MCP server enforces them before returning
content or changing an incident.

## Architecture

```text
Dana / Amir / Eve ── Device Flow ──→ Tutorial IdP (localhost:18003)
        │                                  │ signed access token
        └── terminal chat → OpenRouter → MCP client
                                             │
                    Compose trust boundary   ▼
                    ┌─────────────────────────────────────────┐
                    │ MCP server (PEP) → Cedarling sidecar PDP │
                    │      │              private loopback    │
                    │      ├── DENY → no content / no change   │
                    │      └── ALLOW → incidents / runbook     │
                    │                  / triage                │
                    │ Tutorial IdP shares this namespace      │
                    └─────────────────────────────────────────┘
```

The MCP server verifies the token and `mcp.access` scope. It sends signed token
evidence and current account/incident facts directly to the sidecar's AuthZen
endpoint. Cedarling checks the caller, client, audience, role, and assignment.
Discovery is filtered; direct calls still pass the operation's authorization
boundary. The model never receives the access token or chooses trusted facts.

The readable `policy-store/` is packaged by the shared builder into ignored
`.local/policy-store.cjar`. Compose loads it read-only into the pinned sidecar.
Only the MCP and IdP ports are published on host loopback. The IdP, MCP server,
and sidecar share one local trust boundary; this is a local learning deployment.

## Prerequisites

- Node.js 24.21 or newer within 24.x and pnpm 10 on Ubuntu, macOS, or Windows.
- Docker Engine with Compose v2, or Docker Desktop. The pinned sidecar is
  `linux/amd64`; ARM Docker Desktop needs amd64 emulation.
- An OpenRouter API key in `P3_OPENROUTER_API_KEY` for interactive chat.

P3 starts its own tutorial IdP at `http://localhost:18003` and MCP service at
`http://localhost:17003/mcp`. Other projects use separate ports and IdP instances.

## Run

From this project directory, start the services:

```bash
docker compose up --build
```

Wait for the identity provider and Cedarling sidecar to be healthy. In another
terminal, prepare the host client:

```bash
pnpm install --frozen-lockfile
pnpm run setup
```

Set `P3_OPENROUTER_API_KEY` in the generated `.env`, then start a conversation:

```bash
pnpm chat dana
```

Chat defaults to `liquid/lfm-2.5-2.6b:free`. Set `P3_OPENROUTER_MODEL` to
another tool-calling model if needed. Paid routing requires
`P3_OPENROUTER_ALLOW_PAID=true`; otherwise the client keeps its zero-price cap
and has no paid fallback. Provider availability can vary.
The provider may retain prompts and responses for training; use only fictional
incident data.

Open the displayed verification URL, sign in as the chosen persona, and approve
access. The MCP endpoint is `http://localhost:17003/mcp`. Leave the service
terminal open while using chat.

## Exercise

- **Dana (`dana`)** — Supervisor allowed to operate on every incident.
- **Amir (`amir`)** — Analyst allowed to operate on assigned incidents.
- **Eve (`eve`)** — Authenticated caller with no incident operations.

In `pnpm chat amir`, enter these prompts separately:

```text
Find incident INC-1001.
Read the incident response runbook.
Prepare triage for INC-1001.
Advance INC-1001 from open to investigating.
```

Confirm the status change with `y`; declining leaves the incident unchanged.
P3 advances one incident per request, not a bulk "resolve all" operation.

- **Dana:** `Find incident INC-2001.` returns the unassigned audit incident.
- **Amir:** `Find incident INC-2001.` returns no matching incident;
  `Prepare triage for INC-2001.` returns `authorization_denied`.
- **Eve:** `Find incident INC-1001.` reports no available operations without calling the model.

These are chat requests through MCP, not REST POST examples. The free model must
return a valid tool call before any operation runs. Greetings and unrelated
messages show help without invoking MCP. Chat reports provider, quota,
timeout, and invalid-response failures separately from authorization denials;
free-provider availability is not guaranteed.

The MCP server prints JSON `authorization.decision` or `authorization.failed`
records with actor, action, resource, and application request ID. The sidecar
prints Cedarling's native decision records, including policy reasons. Its native
request IDs are separate from the application's IDs. The token-cache limit is
1,800 seconds, matching the tutorial tokens' 30-minute lifetime. Signature,
issuer, audience, and expiration validation remain enabled.

Cedarling closes both discovery and direct-operation access gaps. Confirmation
prevents accidental changes; it is not authorization. Statuses advance through
`open` → `investigating` → `mitigated` → `resolved`. A sidecar failure denies
access without changing incidents.

Stop and restart the stack with `docker compose down`, then
`docker compose up --build`, to restore incident fixtures. This also rebuilds
the archive after policy edits.

## Commands

| Command               | Purpose                                                      |
| --------------------- | ------------------------------------------------------------ |
| `pnpm run setup`      | Prepare host chat configuration                              |
| `pnpm dev`            | Build and start the Compose service stack                    |
| `pnpm chat <persona>` | Start the terminal conversation                              |
| `pnpm build`          | Package policies and compile the MCP server and client       |
| `pnpm start`          | Start the Compose stack using existing images                |
| `pnpm test:e2e`       | Verify the real isolated Compose stack with a scripted model |
| `pnpm check`          | Run formatting, lint, types, tests, and build                |

## Verify

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level low
```

The end-to-end check uses real signed tokens and the pinned sidecar. It verifies
allowed and denied operations, direct-call bypass attempts, sidecar outage and
recovery, and unchanged protected state. It needs no OpenRouter key and removes
only its own temporary containers and volumes.
