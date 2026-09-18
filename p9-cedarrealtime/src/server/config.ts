import path from "node:path";

export const limits = {
  activeMembersPerRoom: 30,
  socketsPerUser: 5,
  roomsPerSocket: 5,
  messageBytes: 4_096,
  history: 100,
  userMessagesPerWindow: 10,
  roomMessagesPerWindow: 30,
  rateWindowMs: 10_000,
  roomQueue: 100,
  sessionMs: 30 * 60 * 1_000,
  ticketMs: 30_000,
  diagnosticEntries: 100,
  diagnosticMs: 15 * 60 * 1_000,
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
  const port = Number.parseInt(env.P9_PORT ?? "3009", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("P9_PORT must be a valid TCP port");
  }
  const projectRoot = path.resolve(cwd);
  const localRoot = path.join(projectRoot, ".local", "p9-data");
  const dataRoot = path.resolve(projectRoot, env.P9_DATA_ROOT ?? localRoot);
  if (dataRoot !== localRoot && dataRoot !== "/data") {
    throw new Error("P9_DATA_ROOT must be .local/p9-data or /data");
  }
  const clientSecret = required(env, "P9_CLIENT_SECRET");
  if (clientSecret.length < 32) {
    throw new Error("P9_CLIENT_SECRET must contain at least 32 characters");
  }
  const sessionEncryptionKey = Buffer.from(
    required(env, "P9_SESSION_ENCRYPTION_KEY"),
    "base64url",
  );
  if (sessionEncryptionKey.length !== 32) {
    throw new Error(
      "P9_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }
  return {
    host: env.P9_HOST?.trim() || "127.0.0.1",
    port,
    baseUrl: httpUrl(
      env.P9_BASE_URL ?? "http://p9.localhost:3009",
      "P9_BASE_URL",
    ),
    dataRoot,
    issuer: httpUrl(env.P9_ISSUER ?? "http://idp.localhost:4000", "P9_ISSUER"),
    apiResource: httpUrl(
      env.P9_API_RESOURCE ?? "http://p9.localhost:3009/api",
      "P9_API_RESOURCE",
    ),
    clientId: env.P9_CLIENT_ID?.trim() || "p9-cedarrealtime",
    clientSecret,
    sessionEncryptionKey,
  };
}
