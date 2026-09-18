import type { ResponseType } from "oidc-provider";
import { sliceApplications } from "./slice-applications.js";

export type TutorialResourceConfig = Readonly<{
  audience: string;
  scopes: readonly string[];
  accessTokenTtlSeconds: number;
}>;

type TutorialApplicationBase = Readonly<{
  name: string;
  clientId: string;
  grantTypes: readonly string[];
  responseTypes: readonly ResponseType[];
  redirectUris: readonly string[];
  postLogoutRedirectUris: readonly string[];
  resources: ReadonlyMap<string, TutorialResourceConfig>;
}>;

export type TutorialApplicationConfig =
  | (TutorialApplicationBase &
      Readonly<{
        clientType: "confidential";
        clientSecret: string;
        tokenEndpointAuthMethod: "client_secret_basic";
      }>)
  | (TutorialApplicationBase &
      Readonly<{
        clientType: "public";
        tokenEndpointAuthMethod: "none";
      }>);

export type IdentityProviderConfig = Readonly<{
  profile: "default";
  host: string;
  port: number;
  issuer: string;
  applications: ReadonlyMap<string, TutorialApplicationConfig>;
}>;

export const p1TaskScopes = [
  "task.view",
  "task.create",
  "task.edit",
  "task.assign",
  "task.complete",
  "task.delete",
] as const;

export const p2RagScopes = ["corpus.search", "document.retrieve"] as const;

export const p3McpScopes = ["mcp.access"] as const;

export const p4EditorialScopes = [
  "article.read",
  "revision.edit",
  "revision.submit",
  "revision.approve",
  "revision.reject",
  "publication.publish",
] as const;

export const p5DataScopes = ["data.access"] as const;

export const p6InspectionScopes = [
  "workorder.read",
  "workorder.create",
  "workorder.delete",
  "inspection.submit",
  "workorder.reassign",
] as const;
export const p7DocumentScopes = [
  "document.create",
  "document.read",
  "document.edit",
  "comment.create",
  "access.manage",
  "document.observe",
] as const;
export const p8FileScopes = ["file.access"] as const;
export const p9ChatScopes = ["chat.access"] as const;
export const p10WarehouseScopes = ["warehouse.api"] as const;
export const p11WorkspaceScopes = ["workspace.access"] as const;

export const deviceCodeGrantType =
  "urn:ietf:params:oauth:grant-type:device_code";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function clientSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (value.length < 32) {
    throw new Error(`${name} must contain at least 32 characters`);
  }
  return value;
}

function httpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
}

function tcpPort(
  value: string | undefined,
  fallback: string,
  name: string,
): number {
  const port = Number.parseInt(value ?? fallback, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

function apiResource(
  audience: string,
  scopes: readonly string[],
  accessTokenTtlSeconds = 300,
): ReadonlyMap<string, TutorialResourceConfig> {
  return new Map([
    [
      "api",
      {
        audience,
        scopes,
        accessTokenTtlSeconds,
      },
    ],
  ]);
}

function workloadApplication(
  name: string,
  clientId: string,
  clientSecret: string,
  audience: string,
): TutorialApplicationConfig {
  return {
    name,
    clientId,
    clientType: "confidential",
    clientSecret,
    grantTypes: ["client_credentials"],
    responseTypes: [],
    tokenEndpointAuthMethod: "client_secret_basic",
    redirectUris: [],
    postLogoutRedirectUris: [],
    resources: apiResource(audience, p10WarehouseScopes, 300),
  };
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): IdentityProviderConfig {
  const profile = env.IDP_PROFILE?.trim() || "default";
  if (profile !== "default") {
    throw new Error("IDP_PROFILE must be default");
  }
  const port = tcpPort(env.IDP_PORT, "4000", "IDP_PORT");

  const p1ClientSecret = clientSecret(env, "P1_CLIENT_SECRET");
  const p4ClientSecret = clientSecret(env, "P4_CLIENT_SECRET");
  const p5ClientSecret = clientSecret(env, "P5_CLIENT_SECRET");
  const p6ClientSecret = clientSecret(env, "P6_CLIENT_SECRET");
  const p7ClientSecret = clientSecret(env, "P7_CLIENT_SECRET");
  const p8ClientSecret = clientSecret(env, "P8_CLIENT_SECRET");
  const p9ClientSecret = clientSecret(env, "P9_CLIENT_SECRET");
  const p10PlannerSecret = clientSecret(
    env,
    "P10_TRANSFER_PLANNER_CLIENT_SECRET",
  );
  const p10NorthSecret = clientSecret(env, "P10_WAREHOUSE_NORTH_CLIENT_SECRET");
  const p10SouthSecret = clientSecret(env, "P10_WAREHOUSE_SOUTH_CLIENT_SECRET");
  const p10AuditorSecret = clientSecret(
    env,
    "P10_INVENTORY_AUDITOR_CLIENT_SECRET",
  );
  const p11ClientSecret = clientSecret(env, "P11_CLIENT_SECRET");
  const p10ApiResource = httpUrl(
    env.P10_API_RESOURCE ?? "http://p10.localhost:3010/api",
    "P10_API_RESOURCE",
  );

  // Each tutorial owns one explicit client and resource boundary. Provider
  // behavior stays generic as the series grows.
  const applications = new Map<string, TutorialApplicationConfig>([
    [
      "p1-task-manager",
      {
        name: "P1 Task Manager",
        clientId: env.P1_CLIENT_ID?.trim() || "p1-task-manager",
        clientType: "confidential",
        clientSecret: p1ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P1_REDIRECT_URI ?? "http://p1.localhost:3000/auth/callback",
            "P1_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P1_POST_LOGOUT_REDIRECT_URI ?? "http://p1.localhost:3000",
            "P1_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: new Map([
          [
            "api",
            {
              audience: httpUrl(
                env.P1_API_RESOURCE ?? "http://p1.localhost:3000/api",
                "P1_API_RESOURCE",
              ),
              scopes: p1TaskScopes,
              accessTokenTtlSeconds: 300,
            },
          ],
        ]),
      },
    ],
    [
      "p2-tenantrag",
      {
        name: "P2 TenantRAG",
        clientId: env.P2_CLIENT_ID?.trim() || "p2-tenantrag-cli",
        clientType: "public",
        grantTypes: [deviceCodeGrantType],
        responseTypes: [],
        tokenEndpointAuthMethod: "none",
        redirectUris: [],
        postLogoutRedirectUris: [],
        resources: new Map([
          [
            "api",
            {
              audience: httpUrl(
                env.P2_API_RESOURCE ?? "http://p2.localhost:3000/api",
                "P2_API_RESOURCE",
              ),
              scopes: p2RagScopes,
              accessTokenTtlSeconds: 1_800,
            },
          ],
        ]),
      },
    ],
    [
      "p3-mcp-capability-governance",
      {
        name: "P3 MCP Capability Governance",
        clientId:
          env.P3_CLIENT_ID?.trim() || "p3-mcp-capability-governance-cli",
        clientType: "public",
        grantTypes: [deviceCodeGrantType],
        responseTypes: [],
        tokenEndpointAuthMethod: "none",
        redirectUris: [],
        postLogoutRedirectUris: [],
        resources: new Map([
          [
            "mcp",
            {
              audience: httpUrl(
                env.P3_MCP_RESOURCE ?? "http://p3.localhost:3003/mcp",
                "P3_MCP_RESOURCE",
              ),
              scopes: p3McpScopes,
              accessTokenTtlSeconds: 1_800,
            },
          ],
        ]),
      },
    ],
    [
      "p4-editorial-publishing",
      {
        name: "P4 CedarPress",
        clientId: env.P4_CLIENT_ID?.trim() || "p4-editorial-publishing",
        clientType: "confidential",
        clientSecret: p4ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P4_REDIRECT_URI ?? "http://p4.localhost:3004/auth/callback",
            "P4_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P4_POST_LOGOUT_REDIRECT_URI ?? "http://p4.localhost:3004",
            "P4_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: new Map([
          [
            "api",
            {
              audience: httpUrl(
                env.P4_API_RESOURCE ?? "http://p4.localhost:3004/api",
                "P4_API_RESOURCE",
              ),
              scopes: p4EditorialScopes,
              accessTokenTtlSeconds: 1_800,
            },
          ],
        ]),
      },
    ],
    [
      "p5-dataguard",
      {
        name: "P5 DataGuard",
        clientId: env.P5_CLIENT_ID?.trim() || "p5-dataguard",
        clientType: "confidential",
        clientSecret: p5ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P5_REDIRECT_URI ?? "http://p5.localhost:3005/auth/callback",
            "P5_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P5_POST_LOGOUT_REDIRECT_URI ?? "http://p5.localhost:3005",
            "P5_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: new Map([
          [
            "api",
            {
              audience: httpUrl(
                env.P5_API_RESOURCE ?? "http://p5.localhost:3005/api",
                "P5_API_RESOURCE",
              ),
              scopes: p5DataScopes,
              accessTokenTtlSeconds: 1_800,
            },
          ],
        ]),
      },
    ],
    [
      "p6-field-inspection",
      {
        name: "P6 CedarInspect",
        clientId: env.P6_CLIENT_ID?.trim() || "p6-field-inspection",
        clientType: "confidential",
        clientSecret: p6ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P6_REDIRECT_URI ?? "http://p6.localhost:3006/auth/callback",
            "P6_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P6_POST_LOGOUT_REDIRECT_URI ?? "http://p6.localhost:3006",
            "P6_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: apiResource(
          httpUrl(
            env.P6_API_RESOURCE ?? "http://p6.localhost:3006/api",
            "P6_API_RESOURCE",
          ),
          p6InspectionScopes,
          1_800,
        ),
      },
    ],
    [
      "p7-collaborative-docs",
      {
        name: "P7 CedarDocs",
        clientId: env.P7_CLIENT_ID?.trim() || "p7-collaborative-docs",
        clientType: "confidential",
        clientSecret: p7ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P7_REDIRECT_URI ?? "http://p7.localhost:3007/auth/callback",
            "P7_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P7_POST_LOGOUT_REDIRECT_URI ?? "http://p7.localhost:3007",
            "P7_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: apiResource(
          httpUrl(
            env.P7_API_RESOURCE ?? "http://p7.localhost:3007/api",
            "P7_API_RESOURCE",
          ),
          p7DocumentScopes,
          1_800,
        ),
      },
    ],
    [
      "p8-cedarfile",
      {
        name: "P8 CedarFile",
        clientId: env.P8_CLIENT_ID?.trim() || "p8-cedarfile",
        clientType: "confidential",
        clientSecret: p8ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P8_REDIRECT_URI ?? "http://p8.localhost:3008/auth/callback",
            "P8_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P8_POST_LOGOUT_REDIRECT_URI ?? "http://p8.localhost:3008",
            "P8_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: new Map([
          [
            "api",
            {
              audience: httpUrl(
                env.P8_API_RESOURCE ?? "http://p8.localhost:3008/api",
                "P8_API_RESOURCE",
              ),
              scopes: p8FileScopes,
              accessTokenTtlSeconds: 1_800,
            },
          ],
        ]),
      },
    ],
    [
      "p9-cedarrealtime",
      {
        name: "P9 CedarRealtime",
        clientId: env.P9_CLIENT_ID?.trim() || "p9-cedarrealtime",
        clientType: "confidential",
        clientSecret: p9ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P9_REDIRECT_URI ?? "http://p9.localhost:3009/auth/callback",
            "P9_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P9_POST_LOGOUT_REDIRECT_URI ?? "http://p9.localhost:3009",
            "P9_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: apiResource(
          httpUrl(
            env.P9_API_RESOURCE ?? "http://p9.localhost:3009/api",
            "P9_API_RESOURCE",
          ),
          p9ChatScopes,
          1_800,
        ),
      },
    ],
    [
      "p10-transfer-planner",
      workloadApplication(
        "P10 Transfer Planner",
        env.P10_TRANSFER_PLANNER_CLIENT_ID?.trim() || "p10-transfer-planner",
        p10PlannerSecret,
        p10ApiResource,
      ),
    ],
    [
      "p10-warehouse-north",
      workloadApplication(
        "P10 North Warehouse",
        env.P10_WAREHOUSE_NORTH_CLIENT_ID?.trim() || "p10-warehouse-north",
        p10NorthSecret,
        p10ApiResource,
      ),
    ],
    [
      "p10-warehouse-south",
      workloadApplication(
        "P10 South Warehouse",
        env.P10_WAREHOUSE_SOUTH_CLIENT_ID?.trim() || "p10-warehouse-south",
        p10SouthSecret,
        p10ApiResource,
      ),
    ],
    [
      "p10-inventory-auditor",
      workloadApplication(
        "P10 Inventory Auditor",
        env.P10_INVENTORY_AUDITOR_CLIENT_ID?.trim() || "p10-inventory-auditor",
        p10AuditorSecret,
        p10ApiResource,
      ),
    ],
    [
      "p11-saas-workspace",
      {
        name: "P11 SaaS Workspace",
        clientId: env.P11_CLIENT_ID?.trim() || "p11-saas-workspace",
        clientType: "confidential",
        clientSecret: p11ClientSecret,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "client_secret_basic",
        redirectUris: [
          httpUrl(
            env.P11_REDIRECT_URI ?? "http://p11.localhost:3011/auth/callback",
            "P11_REDIRECT_URI",
          ),
        ],
        postLogoutRedirectUris: [
          httpUrl(
            env.P11_POST_LOGOUT_REDIRECT_URI ?? "http://p11.localhost:3011",
            "P11_POST_LOGOUT_REDIRECT_URI",
          ),
        ],
        resources: apiResource(
          httpUrl(
            env.P11_API_RESOURCE ?? "http://p11.localhost:3011/api",
            "P11_API_RESOURCE",
          ),
          p11WorkspaceScopes,
          1_800,
        ),
      },
    ],
  ]);

  for (const {
    prefix,
    id,
    name,
    port: applicationPort,
    scope,
  } of sliceApplications) {
    // Each independently run tutorial enables only the client whose secret it
    // supplies, while sharing the same endpoint and secret validation rules.
    if (env[`${prefix}_CLIENT_SECRET`] === undefined) continue;
    const origin = `http://${prefix.toLowerCase()}.localhost:${applicationPort}`;
    applications.set(id, {
      name,
      clientId: env[`${prefix}_CLIENT_ID`]?.trim() || id,
      clientType: "confidential",
      clientSecret: clientSecret(env, `${prefix}_CLIENT_SECRET`),
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: [
        httpUrl(
          env[`${prefix}_REDIRECT_URI`] ?? `${origin}/auth/callback`,
          `${prefix}_REDIRECT_URI`,
        ),
      ],
      postLogoutRedirectUris: [
        httpUrl(
          env[`${prefix}_POST_LOGOUT_REDIRECT_URI`] ?? origin,
          `${prefix}_POST_LOGOUT_REDIRECT_URI`,
        ),
      ],
      resources: apiResource(
        httpUrl(
          env[`${prefix}_API_RESOURCE`] ?? `${origin}/api`,
          `${prefix}_API_RESOURCE`,
        ),
        [scope],
        1_800,
      ),
    });
  }

  return {
    profile: "default",
    host: env.IDP_HOST?.trim() || "127.0.0.1",
    port,
    issuer: httpUrl(
      env.IDP_ISSUER ?? "http://idp.localhost:4000",
      "IDP_ISSUER",
    ),
    applications,
  };
}
