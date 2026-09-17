import { mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertDirectoryPath, assertSqlitePath } from "./files.ts";
export type Config = Readonly<{
  host: string;
  port: number;
  baseUrl: string;
  issuer: string;
  resource: string;
  clientId: string;
  clientSecret: string;
  dataDir: string;
}>;
function localUrl(value: string, name: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" ||
          url.hostname === "localhost" ||
          url.hostname.endsWith(".localhost"))
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} must be HTTPS or loopback HTTP without credentials, query or fragment`,
    );
  return url.href.replace(/\/$/, "");
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.P12_PORT ?? "3012");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid P12_PORT");
  const host = env.P12_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host))
    throw new Error("P12_HOST must use a local or container bind address");
  const baseUrl = localUrl(
    env.P12_BASE_URL ?? "http://p12.localhost:3012",
    "P12_BASE_URL",
  );
  const origin = new URL(baseUrl);
  if (
    origin.pathname !== "/" ||
    origin.protocol !== "http:" ||
    Number(origin.port || 80) !== port
  )
    throw new Error(
      "P12_BASE_URL must be a loopback HTTP origin matching P12_PORT",
    );
  const issuer = localUrl(
    env.P12_ISSUER ?? "http://idp.localhost:4000",
    "P12_ISSUER",
  );
  const issuerUrl = new URL(issuer);
  const idpPort = Number(
    issuerUrl.port || (issuerUrl.protocol === "https:" ? 443 : 80),
  );
  if (env.P12_IDP_PORT !== undefined && Number(env.P12_IDP_PORT) !== idpPort)
    throw new Error("P12_IDP_PORT must match P12_ISSUER");
  const clientSecret = env.P12_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret.length < 32)
    throw new Error(
      "P12_CLIENT_SECRET must contain at least 32 characters; run setup",
    );
  const dataDir = resolve(env.P12_DATA_DIR ?? ".local/p12-data");
  const below = relative(resolve(".local"), dataDir);
  if (
    !below ||
    below.startsWith(`..${sep}`) ||
    below === ".." ||
    isAbsolute(below)
  )
    throw new Error(
      "P12_DATA_DIR must be a child of this project's .local directory",
    );
  return {
    host,
    port,
    baseUrl,
    issuer,
    resource: localUrl(
      env.P12_API_RESOURCE ?? `${baseUrl}/api`,
      "P12_API_RESOURCE",
    ),
    clientId: env.P12_CLIENT_ID ?? "p12-hr-access-governance",
    clientSecret,
    dataDir,
  };
}
export function prepareDataDirectory(dataDir: string): void {
  const local = resolve(".local");
  const below = relative(local, dataDir);
  if (!below || below.startsWith("..") || isAbsolute(below))
    throw new Error("Data directory escapes .local");
  assertDirectoryPath(dataDir);
  assertSqlitePath(resolve(dataDir, "hr.sqlite"));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
}
