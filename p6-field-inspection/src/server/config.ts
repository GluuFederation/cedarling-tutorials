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
  ) {
    throw new Error(`${name} must be HTTPS or loopback HTTP without extras`);
  }
  return url.href.replace(/\/$/u, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.P6_PORT ?? "3006");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("P6_PORT must be a valid TCP port");
  }
  const host = env.P6_HOST ?? "127.0.0.1";
  if (!new Set(["127.0.0.1", "0.0.0.0"]).has(host)) {
    throw new Error("P6_HOST must be a local or container bind address");
  }
  const baseUrl = localUrl(
    env.P6_BASE_URL ?? "http://p6.localhost:3006",
    "P6_BASE_URL",
  );
  if (Number(new URL(baseUrl).port || 80) !== port) {
    throw new Error("P6_BASE_URL must match P6_PORT");
  }
  const clientSecret = env.P6_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret.length < 32) {
    throw new Error(
      "P6_CLIENT_SECRET must contain at least 32 characters; run setup",
    );
  }
  const dataDirectory = resolve(env.P6_DATA_DIR ?? ".local/p6-data");
  const localDirectory = resolve(".local");
  const below = relative(localDirectory, dataDirectory);
  if (
    !below ||
    below === ".." ||
    below.startsWith(`..${sep}`) ||
    isAbsolute(below)
  ) {
    throw new Error(
      "P6_DATA_DIR must be inside this project's .local directory",
    );
  }
  return {
    host,
    port,
    baseUrl,
    issuer: localUrl(env.P6_ISSUER ?? "http://idp.localhost:4000", "P6_ISSUER"),
    apiResource: localUrl(
      env.P6_API_RESOURCE ?? `${baseUrl}/api`,
      "P6_API_RESOURCE",
    ),
    clientId: env.P6_CLIENT_ID?.trim() || "p6-field-inspection",
    clientSecret,
    dataDirectory,
  };
}

export function prepareDataDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
