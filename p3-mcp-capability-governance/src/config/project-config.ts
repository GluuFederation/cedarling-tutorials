import { resolve } from "node:path";

export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export type P3Config = Readonly<{
  host: string;
  port: number;
  issuer: string;
  clientId: string;
  mcpResource: string;
  accPath: string;
  bindingPath: string;
  openRouterApiKey?: string;
  openRouterModel: "openrouter/free";
  providerTimeoutMs: number;
  driftMode: boolean;
}>;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function httpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error(`${name} must use https outside loopback`);
  }
  if (url.hash) throw new Error(`${name} must not contain a fragment`);
  return url.toString().replace(/\/$/, "");
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
): P3Config {
  const projectRoot = resolve(currentDirectory);
  return {
    host: env.P3_HOST?.trim() || "127.0.0.1",
    port: integer(env.P3_PORT, 3003, "P3_PORT", 1, 65_535),
    issuer: httpUrl(env.P3_ISSUER ?? "http://idp.localhost:4000", "P3_ISSUER"),
    clientId: env.P3_CLIENT_ID?.trim() || "p3-mcp-capability-governance-cli",
    mcpResource: httpUrl(
      env.P3_MCP_RESOURCE ?? "http://p3.localhost:3003/mcp",
      "P3_MCP_RESOURCE",
    ),
    accPath: resolve(projectRoot, "ACC.yaml"),
    bindingPath: resolve(projectRoot, "mcp-binding.json"),
    ...(env.P3_OPENROUTER_API_KEY?.trim()
      ? { openRouterApiKey: env.P3_OPENROUTER_API_KEY.trim() }
      : {}),
    openRouterModel: "openrouter/free",
    providerTimeoutMs: integer(
      env.P3_PROVIDER_TIMEOUT_MS,
      15_000,
      "P3_PROVIDER_TIMEOUT_MS",
      1_000,
      60_000,
    ),
    driftMode: env.P3_DRIFT_MODE === "true",
  };
}
