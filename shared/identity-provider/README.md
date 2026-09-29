# Cedarling Tutorial Identity Provider

Reusable local OpenID Provider source for the Cedarling tutorial projects.
Each project runs a separate instance, selected by `IDP_PROJECT=P1` through `P15`. It uses
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
the exact `http://localhost:17001/api` resource. The provider issues:

| Artifact            | Format                                            | Lifetime   |
| ------------------- | ------------------------------------------------- | ---------- |
| P1 API access token | RS256 JWT with the P1 API audience                | 5 minutes  |
| ID token            | RS256 JWT with synthetic profile and email claims | 5 minutes  |
| Refresh token       | Opaque and rotated on use                         | 20 minutes |
| Provider session    | In-memory cookie session                          | 20 minutes |

P2 uses a public Device Authorization Grant client. It requests
`openid profile email`, `corpus.search`, and `document.retrieve` for the exact
`http://localhost:17002/api` resource. Its API access token is a thirty-minute
RS256 JWT; the P2 helper keeps it transient.

P3 uses a public Device Authorization Grant client. It requests `openid`,
`profile`, `email`, and `mcp.access` for the exact
`http://localhost:17003/mcp` resource. Its access token is a thirty-minute
RS256 JWT retained by the terminal process.

P4 and P5 use confidential Authorization Code clients with PKCE S256 and
rotating refresh tokens. P4 requests its six editorial capabilities for
`http://localhost:17004/api`; P5 requests `data.access` for
`http://localhost:17005/api`. Their resource access tokens last thirty
minutes, while each application owns its bounded server session.

P6 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Elena, Malik, and Rowan. It requests the field-inspection
capabilities for `http://localhost:17006/api`; the application keeps tokens
inside its Node.js BFF.

P7 uses a confidential Authorization Code client with PKCE S256 for Maya,
Noah, and Lena. It requests the six collaborative-document capabilities for
the exact `http://localhost:17007/api` resource.

P8 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Jordan, Priya, and Lee. It requests `file.access` for the
exact `http://localhost:17008/api` resource.

P9 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Mei, Kwame, and Yuki. It requests `chat.access` for the
exact `http://localhost:17009/api` resource.

P10 registers four confidential Client Credentials workloads: transfer
planner, North Warehouse, South Warehouse, and inventory auditor. Each has an
independent secret and receives a five-minute JWT containing the common
`warehouse.api` scope for the exact `http://localhost:17010/api` resource.
The Warehouse API and Cedarling decide operation-specific authority.

P11 uses a confidential Authorization Code client with PKCE S256 and rotating
refresh tokens for Maya, Noah, Lena, and Imani. It requests
`workspace.access` for the exact `http://localhost:17011/api` resource.

P12–P15 also use confidential Authorization Code clients with PKCE S256:

| Client                        | Resource                     | Scope             |
| ----------------------------- | ---------------------------- | ----------------- |
| `p12-hr-access-governance`    | `http://localhost:17012/api` | `hr.access`       |
| `p13-student-records`         | `http://localhost:17013/api` | `grade.access`    |
| `p14-ai-scheduling-assistant` | `http://localhost:17014/api` | `schedule.access` |
| `p15-marketplace`             | `http://localhost:17015/api` | `refund.access`   |

Project setup generates only its own client registrations and secrets.
Re-running setup preserves credentials and synchronizes the application settings.
P2 and P3 are public clients; P10 has four independent workload credentials.

The UserInfo endpoint is disabled; these projects use signed ID and access tokens.

## Tutorial boundary

This service is local teaching infrastructure, not production authentication.
It binds to loopback by default, stores provider state and signing keys in
memory, and invalidates all sessions on restart. Never expose it to an untrusted
network or use its synthetic credentials for real authentication.

## Run independently

From the chosen project directory:

```bash
pnpm --dir ../shared/identity-provider install --frozen-lockfile
pnpm --dir ../shared/identity-provider build
pnpm install --frozen-lockfile
pnpm run setup
node --env-file=.local/idp/.env ../shared/identity-provider/dist/main.js
```

The project README lists any additional setup requirements. The process reads
the explicit environment file, not a global provider configuration. Project n
uses localhost ports 18000 + n for its issuer and 17000 + n for its application
(P1: `http://localhost:18001` and `http://localhost:17001`).
Docker uses the same issuer and application URLs.

IdP cookies have project-specific names. They prevent accidental session
collisions, not hostile isolation between services on localhost. Keep the
tutorial provider on loopback and use only synthetic credentials.

## Verify

```bash
pnpm check
```
