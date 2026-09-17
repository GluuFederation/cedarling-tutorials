import { mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type Config = Readonly<{
  host: string;
  port: number;
  baseUrl: string;
  issuer: string;
  apiResource: string;
  clientId: string;
  clientSecret: string;
  sessionEncryptionKey: Buffer;
  dataDirectory: string;
}>;

function localUrl(value: string, name: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost");
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(`${name} must be HTTPS or loopback HTTP without extras`);
  return url.href.replace(/\/$/u, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.P14_PORT ?? "3014");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("P14_PORT must be a valid TCP port");
  const host = env.P14_HOST ?? "127.0.0.1";
  if (!new Set(["127.0.0.1", "0.0.0.0"]).has(host))
    throw new Error("P14_HOST must be a local or container bind address");
  const baseUrl = localUrl(
    env.P14_BASE_URL ?? "http://p14.localhost:3014",
    "P14_BASE_URL",
  );
  if (Number(new URL(baseUrl).port || 80) !== port)
    throw new Error("P14_BASE_URL must match P14_PORT");
  const clientSecret = env.P14_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret.length < 32)
    throw new Error(
      "P14_CLIENT_SECRET must contain at least 32 characters; run setup",
    );
  const rawKey = env.P14_SESSION_ENCRYPTION_KEY?.trim();
  const sessionEncryptionKey = rawKey
    ? Buffer.from(rawKey, "base64url")
    : Buffer.alloc(0);
  if (sessionEncryptionKey.length !== 32)
    throw new Error(
      "P14_SESSION_ENCRYPTION_KEY must decode to 32 bytes; run setup",
    );
  const dataDirectory = resolve(env.P14_DATA_DIR ?? ".local/p14-data");
  const localDirectory = resolve(".local");
  const below = relative(localDirectory, dataDirectory);
  if (
    dataDirectory !== "/app/.local/p14-data" &&
    (!below ||
      below === ".." ||
      below.startsWith(`..${sep}`) ||
      isAbsolute(below))
  )
    throw new Error(
      "P14_DATA_DIR must be inside this project's .local directory",
    );
  return {
    host,
    port,
    baseUrl,
    issuer: localUrl(
      env.P14_ISSUER ?? "http://idp.localhost:4000",
      "P14_ISSUER",
    ),
    apiResource: localUrl(
      env.P14_API_RESOURCE ?? `${baseUrl}/api`,
      "P14_API_RESOURCE",
    ),
    clientId: env.P14_CLIENT_ID?.trim() || "p14-ai-scheduling-assistant",
    clientSecret,
    sessionEncryptionKey,
    dataDirectory,
  };
}

export function prepareDataDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
