import path from "node:path";

export const limits = {
  fileBytes: 16 * 1024 * 1024,
  workspaceBytes: 128 * 1024 * 1024,
  workspaceResources: 100,
  recursiveResources: 50,
  nameBytes: 120,
  sessionMs: 30 * 60 * 1000,
} as const;

export type AppConfig = Readonly<{
  host: string;
  port: number;
  baseUrl: string;
  dataRoot: string;
  issuer: string;
  apiResource: string;
  clientId: string;
  clientSecret: string;
  sessionEncryptionKey: Buffer;
}>;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required; run pnpm run setup`);
  return value;
}

function httpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const port = Number.parseInt(env.P8_PORT ?? "3008", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("P8_PORT must be a valid TCP port");
  }

  const projectRoot = path.resolve(cwd);
  const localRoot = path.join(projectRoot, ".local", "p8-data");
  const dataRoot = path.resolve(projectRoot, env.P8_DATA_ROOT ?? localRoot);
  if (dataRoot !== localRoot && dataRoot !== "/data") {
    throw new Error("P8_DATA_ROOT must be .local/p8-data or /data");
  }

  const rawKey = required(env, "P8_SESSION_ENCRYPTION_KEY");
  const sessionEncryptionKey = Buffer.from(rawKey, "base64url");
  if (sessionEncryptionKey.length !== 32) {
    throw new Error(
      "P8_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }
  const clientSecret = required(env, "P8_CLIENT_SECRET");
  if (clientSecret.length < 32) {
    throw new Error("P8_CLIENT_SECRET must contain at least 32 characters");
  }

  return {
    host: env.P8_HOST?.trim() || "127.0.0.1",
    port,
    baseUrl: httpUrl(
      env.P8_BASE_URL ?? "http://p8.localhost:3008",
      "P8_BASE_URL",
    ),
    dataRoot,
    issuer: httpUrl(env.P8_ISSUER ?? "http://idp.localhost:4000", "P8_ISSUER"),
    apiResource: httpUrl(
      env.P8_API_RESOURCE ?? "http://p8.localhost:3008/api",
      "P8_API_RESOURCE",
    ),
    clientId: env.P8_CLIENT_ID?.trim() || "p8-cedarfile",
    clientSecret,
    sessionEncryptionKey,
  };
}
