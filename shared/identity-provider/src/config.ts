import type { ResponseType } from "oidc-provider";
import { projectSettings, workloads } from "./projects.js";

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
  project: string;
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
  "article.create",
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

/** Select only this project's clients; other projects' secrets are never required. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): IdentityProviderConfig {
  const project = projectSettings(env.IDP_PROJECT);
  const prefix = project.prefix;
  const scopes: Record<typeof project.number, readonly string[]> = {
    1: p1TaskScopes,
    2: p2RagScopes,
    3: p3McpScopes,
    4: p4EditorialScopes,
    5: p5DataScopes,
    6: p6InspectionScopes,
    7: p7DocumentScopes,
    8: p8FileScopes,
    9: p9ChatScopes,
    10: p10WarehouseScopes,
    11: p11WorkspaceScopes,
    12: ["hr.access"],
    13: ["grade.access"],
    14: ["schedule.access"],
    15: ["refund.access"],
  };
  const resourceName = project.number === 3 ? "mcp" : "api";
  const resourceKey = `${prefix}_${resourceName.toUpperCase()}_RESOURCE`;
  const audience = httpUrl(
    env[resourceKey] ?? `${project.origin}/${resourceName}`,
    resourceKey,
  );
  const ttl = project.number === 1 || project.number === 10 ? 300 : 1_800;
  const resources = new Map([
    [
      resourceName,
      {
        audience,
        scopes: scopes[project.number],
        accessTokenTtlSeconds: ttl,
      },
    ],
  ]);
  const applications = new Map<string, TutorialApplicationConfig>();
  if (project.number === 10) {
    for (const workload of workloads) {
      applications.set(workload.id, {
        name: workload.name,
        clientId: env[`${workload.prefix}_CLIENT_ID`]?.trim() || workload.id,
        clientType: "confidential",
        clientSecret: clientSecret(env, `${workload.prefix}_CLIENT_SECRET`),
        tokenEndpointAuthMethod: "client_secret_basic",
        grantTypes: ["client_credentials"],
        responseTypes: [],
        redirectUris: [],
        postLogoutRedirectUris: [],
        resources,
      });
    }
  } else {
    const common = {
      name: project.name,
      clientId:
        env[`${prefix}_CLIENT_ID`]?.trim() ||
        `${project.id}${project.device ? "-cli" : ""}`,
      resources,
    };
    applications.set(
      project.id,
      project.device
        ? {
            ...common,
            clientType: "public",
            tokenEndpointAuthMethod: "none",
            grantTypes: [deviceCodeGrantType],
            responseTypes: [],
            redirectUris: [],
            postLogoutRedirectUris: [],
          }
        : {
            ...common,
            clientType: "confidential",
            tokenEndpointAuthMethod: "client_secret_basic",
            clientSecret: clientSecret(env, `${prefix}_CLIENT_SECRET`),
            grantTypes: ["authorization_code", "refresh_token"],
            responseTypes: ["code"],
            redirectUris: [
              httpUrl(
                env[`${prefix}_REDIRECT_URI`] ??
                  `${project.origin}/auth/callback`,
                `${prefix}_REDIRECT_URI`,
              ),
            ],
            postLogoutRedirectUris: [
              httpUrl(
                env[`${prefix}_POST_LOGOUT_REDIRECT_URI`] ?? project.origin,
                `${prefix}_POST_LOGOUT_REDIRECT_URI`,
              ),
            ],
          },
    );
  }
  return {
    project: prefix,
    host: env.IDP_HOST?.trim() || "127.0.0.1",
    port: tcpPort(env.IDP_PORT, String(project.idpPort), "IDP_PORT"),
    issuer: httpUrl(env.IDP_ISSUER ?? project.issuer, "IDP_ISSUER"),
    applications,
  };
}
