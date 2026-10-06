# Cedarling Tutorials

![Cedarling Tutorials: learn authorization by building real applications.](./.github/assets/tutorials-banner.png)

<p align="center">
  <a href="#start-with-a-task-manager">Start here</a> ·
  <a href="#find-your-next-project">Explore the projects</a> ·
  <a href="https://cedarling.dev/playground">Try the playground</a> ·
  <a href="https://docs.jans.io/stable/cedarling/">Cedarling docs</a>
</p>

Practice authorization with fifteen independent applications, from a task board
to AI assistants and machine-to-machine transfers. Each project has sample users
or workloads, a setup guide, exercises, and tests. Start with P1 or pick a problem
that matches your own application.

> [!NOTE]
> P1-P5 include Cedarling authorization. P6-P15 retain the tutorial starting
> applications, whose marked authorization checks return `FAKE ALLOW`.

## Start with a task manager

[Run P1](./p1-task-manager/README.md) to try a React task board whose API checks
task permissions with Cedarling. To build the integration yourself, follow the
[tutorial](./p1-task-manager/docs/tutorials.md) from its permissive starting
application through server enforcement and browser guidance.

## Find your next project

Project links open the setup guides; article links open the published tutorials.

| Project                                                                                            | Stack                                                     | What you'll learn                                                                         | Articles                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [P1 - Protecting a Node.js REST API with Cedarling](./p1-task-manager/)                            | Node.js, Fastify, React, SQLite                           | Keep tenants' tasks separate and control who can read or change them.                     | [Read tutorial](https://cedarling.dev/learn/protect-a-nodejs-rest-api-with-cedarling)           |
| [P2 - Preventing Cross-Tenant RAG Data Leaks with Cedarling](./p2-tenantrag/)                      | Node.js, Fastify, Orama, Voyage, OpenRouter               | Check access to search results before documents reach AI generation.                      | [Read tutorial](https://cedarling.dev/learn/prevent-cross-tenant-rag-data-leaks-with-cedarling) |
| [P3 - Authorizing MCP Incident Operations with Cedarling](./p3-mcp-capability-governance/)         | Node.js, MCP, Express, OpenRouter                         | Control an assistant's access to incident tools, runbooks, and triage prompts.            | [Read tutorial](https://cedarling.dev/learn/govern-mcp-capabilities)                            |
| [P4 - Securing Editorial Publishing with Cedarling](./p4-editorial-publishing/)                    | Node.js, Next.js App Router, React, SQLite                | Tie publishing approval to the reviewed revision and current reviewer authority.          | [Read tutorial](https://cedarling.dev/learn/secure-editorial-publishing)                        |
| [P5 - Protecting Sensitive Fields and Data Exports with Cedarling](./p5-dataguard/)                | Node.js, Hono, React, SQLite                              | Protect individual records, sensitive fields, aggregates, and data exports.               | [Read tutorial](https://cedarling.dev/learn/protect-sensitive-data-exports)                     |
| [P6 - Reauthorizing Offline Field Inspections with Cedarling](./p6-field-inspection/)              | Node.js, Fastify, React, SQLite, IndexedDB                | Check current assignments before accepting work saved while offline.                      | -                                                                                               |
| [P7 - Securing Real-Time Collaborative Documents with Cedarling](./p7-collaborative-docs/)         | Node.js, Fastify, React, SQLite, SSE                      | Apply changing permissions to document edits, comments, sharing, and live updates.        | -                                                                                               |
| [P8 - Securing File Sharing and Blocking Path Traversal with Cedarling](./p8-cedarfile/)           | Node.js, Express, React, SQLite                           | Combine file-access decisions with application-owned filesystem safeguards.               | -                                                                                               |
| [P9 - Securing Realtime Chat Rooms and Events with Cedarling](./p9-cedarrealtime/)                 | Node.js, Express, Socket.IO, React, SQLite                | Recheck access when people join, reconnect, receive messages, or moderate a room.         | -                                                                                               |
| [P10 - Authorizing Warehouse Workloads with Cedarling](./p10-warehouse-workloads/)                 | Node.js, Fastify, React, SQLite, OAuth Client Credentials | Authorize machine-to-machine transfers using warehouse relationships and current state.   | -                                                                                               |
| [P11 - Securing Active-Tenant Switching in a SaaS Workspace with Cedarling](./p11-saas-workspace/) | Node.js, React Router Framework Mode, Express, PostgreSQL | Reevaluate access as users switch tenants, accept invitations, or receive support access. | -                                                                                               |
| [P12 - Governing Employee Record Access with Cedarling](./p12-hr-access-governance/)               | Node.js, Express, React, SQLite                           | Grant and revoke employee-record access while separating requesters from approvers.       | -                                                                                               |
| [P13 - Protecting Grade Publication and Guardian Access with Cedarling](./p13-student-records/)    | Node.js, Express, React, SQLite                           | Separate grade editing, publication, student access, and guardian access.                 | -                                                                                               |
| [P14 - Governing an AI Scheduling Assistant with Cedarling](./p14-ai-scheduling-assistant/)        | Node.js, Fastify, React, SQLite                           | Authorize each scheduling action an assistant proposes before it changes anything.        | -                                                                                               |
| [P15 - Authorizing a Multi-Party Marketplace Refund with Cedarling](./p15-marketplace/)            | Node.js, Express, React, SQLite                           | Give buyers, sellers, support, and fraud reviewers the right views and refund actions.    | -                                                                                               |

## Run the projects your way

Follow the chosen project's README for prerequisites and startup commands.
Most support Docker and native Node.js development. P3 requires Docker for its
Cedarling sidecar and runs the chat client on the host.

Project `PN` uses application port `17000 + N` and identity-provider port `18000 + N`:
P1 uses `17001` / `18001`, and P15 uses `17015` / `18015`.
Each project README gives its exact URL; P3 exposes an MCP service rather than a web interface.

You can run different projects together. Stop a project's Docker stack before
running that same project natively. Each project runs its own identity provider
from shared source code, with separate registrations and cookie names.

These stacks assume a trusted local machine. Ports do not isolate browser
cookies, and a project's Docker application services share its IdP's network
namespace.

## Explore and verify the code

Each `pN-project-name/` directory owns its source, dependencies, lockfile,
configuration, and tests. Shared identity-provider code lives in
[`shared/identity-provider/`](./shared/identity-provider/). Install dependencies
inside the package you are working on; there is no root pnpm workspace.

From that package directory:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit --audit-level low
```

`pnpm check` runs the package's quality checks. Also run `pnpm test:e2e` when
listed separately in the project's Verify section.

For more examples, visit [Cedarling Learn](https://cedarling.dev/learn).
The [engine source](https://github.com/JanssenProject/jans/tree/main/jans-cedarling)
is maintained in the Janssen Project repository.

## License

[Apache License 2.0](./LICENSE).
