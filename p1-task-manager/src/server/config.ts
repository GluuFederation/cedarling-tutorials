import path from "node:path";

export type AppConfig = Readonly<{
  host: string;
  port: number;
  baseUrl: string;
  dataDirectory: string;
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

function normalizedUrl(value: string, name: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`${name} must use HTTP or HTTPS`);
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const port = Number.parseInt(env.P1_PORT ?? "17001", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("P1_PORT must be a valid TCP port");

  const rawKey = required(env, "P1_SESSION_ENCRYPTION_KEY");
  const sessionEncryptionKey = Buffer.from(rawKey, "base64url");
  if (sessionEncryptionKey.length !== 32)
    throw new Error(
      "P1_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );

  const dataDirectory = path.resolve(cwd, env.P1_DATA_DIR?.trim() || ".data");
  const expectedRoot = path.resolve(cwd);
  if (
    dataDirectory !== path.join(expectedRoot, ".data") &&
    !dataDirectory.startsWith(`${expectedRoot}${path.sep}`)
  ) {
    throw new Error("P1_DATA_DIR must stay inside the project directory");
  }

  const clientSecret = required(env, "P1_CLIENT_SECRET");
  if (clientSecret.length < 32)
    throw new Error("P1_CLIENT_SECRET must contain at least 32 characters");

  const issuer = normalizedUrl(
    env.P1_ISSUER ?? "http://localhost:18001",
    "P1_ISSUER",
  );
  const apiResource = normalizedUrl(
    env.P1_API_RESOURCE ?? "http://localhost:17001/api",
    "P1_API_RESOURCE",
  );
  if (
    issuer !== "http://localhost:18001" ||
    apiResource !== "http://localhost:17001/api"
  )
    throw new Error(
      "P1 policies require issuer http://localhost:18001 and API audience http://localhost:17001/api; align .local/idp/.env and run pnpm run setup",
    );

  const baseUrl = normalizedUrl(
    env.P1_BASE_URL ?? "http://localhost:17001",
    "P1_BASE_URL",
  );
  const origin = new URL(baseUrl);
  if (port !== Number(origin.port || (origin.protocol === "https:" ? 443 : 80)))
    throw new Error("P1_PORT must match P1_BASE_URL; run pnpm run setup");

  return {
    host: env.P1_HOST?.trim() || "127.0.0.1",
    port,
    baseUrl,
    dataDirectory,
    issuer,
    apiResource,
    clientId: env.P1_CLIENT_ID?.trim() || "p1-task-manager",
    clientSecret,
    sessionEncryptionKey,
  };
}
