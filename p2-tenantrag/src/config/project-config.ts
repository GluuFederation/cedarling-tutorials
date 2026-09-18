import { resolve } from "node:path";

export type P2Config = Readonly<{
  host: string;
  port: number;
  baseUrl: string;
  issuer: string;
  apiResource: string;
  clientId: string;
  fixturesDirectory: string;
  artifactPath: string;
  voyageApiKey: string;
  voyageModel: "voyage-4-lite";
  voyageDimensions: 256;
  openRouterApiKey: string;
  openRouterModel: "openrouter/free";
  providerTimeoutMs: number;
}>;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
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
): P2Config {
  const projectRoot = resolve(env.P2_PROJECT_ROOT?.trim() || currentDirectory);
  const voyageDimensions = integer(
    env.P2_VOYAGE_DIMENSIONS,
    256,
    "P2_VOYAGE_DIMENSIONS",
    256,
    256,
  );

  return {
    host: env.P2_HOST?.trim() || "127.0.0.1",
    port: integer(env.P2_PORT, 3000, "P2_PORT", 1, 65_535),
    baseUrl: httpUrl(
      env.P2_BASE_URL ?? "http://p2.localhost:3000",
      "P2_BASE_URL",
    ),
    issuer: httpUrl(env.P2_ISSUER ?? "http://idp.localhost:4000", "P2_ISSUER"),
    apiResource: httpUrl(
      env.P2_API_RESOURCE ?? "http://p2.localhost:3000/api",
      "P2_API_RESOURCE",
    ),
    clientId: env.P2_CLIENT_ID?.trim() || "p2-tenantrag-cli",
    fixturesDirectory: resolve(projectRoot, "fixtures"),
    artifactPath: resolve(projectRoot, "data", "orama-index.json"),
    voyageApiKey: required(env, "P2_VOYAGE_API_KEY"),
    voyageModel: "voyage-4-lite",
    voyageDimensions: voyageDimensions as 256,
    openRouterApiKey: required(env, "P2_OPENROUTER_API_KEY"),
    openRouterModel: "openrouter/free",
    providerTimeoutMs: integer(
      env.P2_PROVIDER_TIMEOUT_MS,
      15_000,
      "P2_PROVIDER_TIMEOUT_MS",
      1_000,
      60_000,
    ),
  };
}
