import { mkdirSync } from "node:fs";
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
  sessionEncryptionKey: Uint8Array;
}>;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required; run pnpm run setup`);
  return value;
}

function normalizedUrl(value: string, name: string): string {
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
  const port = Number.parseInt(env.P5_PORT ?? "3005", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("P5_PORT must be a valid TCP port");
  }
  const rawKey = required(env, "P5_SESSION_ENCRYPTION_KEY");
  const sessionEncryptionKey = Buffer.from(rawKey, "base64url");
  if (sessionEncryptionKey.length !== 32) {
    throw new Error(
      "P5_SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }
  const clientSecret = required(env, "P5_CLIENT_SECRET");
  if (clientSecret.length < 32) {
    throw new Error("P5_CLIENT_SECRET must contain at least 32 characters");
  }

  const root = path.resolve(cwd);
  const dataDirectory = path.resolve(root, env.P5_DATA_DIR?.trim() || ".data");
  if (
    dataDirectory !== path.join(root, ".data") &&
    !dataDirectory.startsWith(`${root}${path.sep}`)
  ) {
    throw new Error("P5_DATA_DIR must stay inside the project directory");
  }

  return {
    host: env.P5_HOST?.trim() || "127.0.0.1",
    port,
    baseUrl: normalizedUrl(
      env.P5_BASE_URL ?? "http://p5.localhost:3005",
      "P5_BASE_URL",
    ),
    dataDirectory,
    issuer: normalizedUrl(
      env.P5_ISSUER ?? "http://idp.localhost:4000",
      "P5_ISSUER",
    ),
    apiResource: normalizedUrl(
      env.P5_API_RESOURCE ?? "http://p5.localhost:3005/api",
      "P5_API_RESOURCE",
    ),
    clientId: env.P5_CLIENT_ID?.trim() || "p5-dataguard",
    clientSecret,
    sessionEncryptionKey,
  };
}

export function prepareDataDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
