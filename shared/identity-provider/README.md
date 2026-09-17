# Cedarling Tutorial Identity Provider

Shared local OpenID Provider for the Cedarling tutorial projects. It uses
`oidc-provider`, an independently configured client and resource boundary for
each application, and the provider's default development login and consent
pages.

Sign in with `alex`, `mina`, or `sam` for P1 and `ada`, `leo`, or `mallory` for
P2. P3 uses `dana`, `amir`, and `eve`; P4 uses `riley`, `ana`, and `omar`; P5
uses `amina`, `leah`, and `theo`; P6 uses `elena`, `malik`, and `rowan`; P7 uses
`maya`, `noah`, and `lena`; P8 uses `jordan`, `priya`, and `lee`; P9 uses `mei`, `kwame`, and
`yuki`; P11 uses `maya`, `noah`, `lena`, and `imani`. P12 uses `lin`, `nia`,
and `ben`; P13 uses `talia`, the
existing `sam`, and `grace`; P14 uses `dina`, `amara`, `benoit`, and `chloe`;
P15 uses `bao`, `sela`, `diego`, and the existing `nia`.
The default development form requires a password but
accepts any non-empty value.

P1 requests `openid profile email offline_access` and its six task scopes for
the exact `http://p1.localhost:3000/api` resource. The provider issues:

| Artifact            | Format                                            | Lifetime   |
| ------------------- | ------------------------------------------------- | ---------- |
| P1 API access token | RS256 JWT with the P1 API audience                | 5 minutes  |
| ID token            | RS256 JWT with synthetic profile and email claims | 5 minutes  |
| Refresh token       | Opaque and rotated on use                         | 20 minutes |
| Provider session    | In-memory cookie session                          | 20 minutes |

P2 uses a public Device Authorization Grant client. It requests
`openid profile email`, `corpus.search`, and `document.retrieve` for the exact
`http://p2.localhost:3000/api` resource. Its API access token is a thirty-minute
RS256 JWT; the P2 helper keeps it transient.

P3 uses a public Device Authorization Grant client. It requests `openid`,
`profile`, `email`, and `mcp.access` for the exact
`http://p3.localhost:3003/mcp` resource. Its access token is a thirty-minute
RS256 JWT retained by the terminal process.

P4 and P5 use confidential Authorization Code clients with PKCE S256 and
rotating refresh tokens. P4 requests its six editorial capabilities for
`http://p4.localhost:3004/api`; P5 requests `data.access` for
`http://p5.localhost:3005/api`. Their resource access tokens last thirty
minutes, while each application owns its bounded server session.

P6 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Elena, Malik, and Rowan. It requests the field-inspection
capabilities for `http://p6.localhost:3006/api`; the application keeps tokens
inside its Node.js BFF.

P7 uses a confidential Authorization Code client with PKCE S256 for Maya,
Noah, and Lena. It requests the six collaborative-document capabilities for
the exact `http://p7.localhost:3007/api` resource.

P8 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Jordan, Priya, and Lee. It requests `file.access` for the
exact `http://p8.localhost:3008/api` resource.

P9 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Mei, Kwame, and Yuki. It requests `chat.access` for the
exact `http://p9.localhost:3009/api` resource.

P10 registers four confidential Client Credentials workloads: transfer
planner, North Warehouse, South Warehouse, and inventory auditor. Each has an
independent secret and receives a five-minute JWT containing the common
`warehouse.api` scope for the exact `http://p10.localhost:3010/api` resource.
The Warehouse API and Cedarling decide operation-specific authority.

P11 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Maya, Noah, Lena, and Imani. It requests
`workspace.access` for the exact `http://p11.localhost:3011/api` resource.

P12–P15 also use confidential Authorization Code clients with PKCE S256:

| Client                        | Resource                        | Scope             |
| ----------------------------- | ------------------------------- | ----------------- |
| `p12-hr-access-governance`    | `http://p12.localhost:3012/api` | `hr.access`       |
| `p13-student-records`         | `http://p13.localhost:3013/api` | `grade.access`    |
| `p14-ai-scheduling-assistant` | `http://p14.localhost:3014/api` | `schedule.access` |
| `p15-marketplace`             | `http://p15.localhost:3015/api` | `refund.access`   |

Setup generates each client secret without replacing existing settings. A
registration is enabled when its `Pn_CLIENT_SECRET` is supplied, so each
independent project can configure only its own client. `Pn_CLIENT_ID`,
`Pn_REDIRECT_URI`, `Pn_POST_LOGOUT_REDIRECT_URI`, and `Pn_API_RESOURCE` support
isolated local scenario endpoints.

The UserInfo endpoint is disabled. Signed UserInfo is deferred until a tutorial
needs it; P1 does not manufacture a “UserInfo token.”

## Tutorial boundary

This service is local teaching infrastructure, not production authentication.
It binds to loopback by default, stores provider state and signing keys in
memory, and invalidates all sessions on restart. Never expose it to an untrusted
network or use its synthetic credentials for real authentication.

## Run independently

Generate missing provider-local settings and client secrets, then run:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm run setup` appends missing settings and preserves every existing `.env`
value. The provider loads only this package's `.env`. Each confidential
application copies its matching client values into its own local `.env` during
application setup. Runtime configuration remains project-local.

## Verify

```bash
pnpm check
```
