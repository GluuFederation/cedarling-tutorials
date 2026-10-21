import { lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

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
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} must be HTTPS or loopback HTTP without credentials, query or fragment`,
    );
  return url.href.replace(/\/$/u, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
): Config {
  const port = Number(env.P14_PORT ?? "17014");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("P14_PORT must be a valid TCP port");
  const host = env.P14_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host))
    throw new Error("P14_HOST must be a loopback or container bind address");
  const baseUrl = localUrl(
    env.P14_BASE_URL ?? `http://localhost:${port}`,
    "P14_BASE_URL",
  );
  const application = new URL(baseUrl);
  if (application.pathname !== "/")
    throw new Error("P14_BASE_URL must be an origin without a path");
  if (
    Number(
      application.port || (application.protocol === "https:" ? 443 : 80),
    ) !== port
  )
    throw new Error("P14_BASE_URL must match P14_PORT");
  const issuer = localUrl(
    env.P14_ISSUER ?? "http://localhost:18014",
    "P14_ISSUER",
  );
  const apiResource = localUrl(
    env.P14_API_RESOURCE ?? `${baseUrl}/api`,
    "P14_API_RESOURCE",
  );
  if (apiResource !== `${baseUrl}/api`)
    throw new Error("P14_API_RESOURCE must match the application API");
  const clientSecret = env.P14_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret.length < 32)
    throw new Error(
      "P14_CLIENT_SECRET must contain at least 32 characters; run pnpm setup",
    );
  const rawKey = env.P14_SESSION_ENCRYPTION_KEY?.trim();
  const sessionEncryptionKey = Buffer.from(rawKey ?? "", "base64url");
  if (
    sessionEncryptionKey.length !== 32 ||
    sessionEncryptionKey.toString("base64url") !== rawKey
  )
    throw new Error(
      "P14_SESSION_ENCRYPTION_KEY must encode 32 bytes; run pnpm setup",
    );
  const dataDirectory = resolve(root, env.P14_DATA_DIR ?? ".local/p14-data");
  const below = relative(resolve(root, ".local"), dataDirectory);
  if (
    !below ||
    below === ".." ||
    below.startsWith(`..${sep}`) ||
    isAbsolute(below)
  )
    throw new Error(
      "P14_DATA_DIR must be inside this project's .local directory",
    );
  assertNoSymlinks(dataDirectory);
  return {
    host,
    port,
    baseUrl,
    issuer,
    apiResource,
    clientId: env.P14_CLIENT_ID?.trim() || "p14-capital-district",
    clientSecret,
    sessionEncryptionKey,
    dataDirectory,
  };
}

export function prepareDataDirectory(directory: string): void {
  assertNoSymlinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of ["auth.sqlite", "game.sqlite"])
    assertNoSymlinks(resolve(directory, name));
}

function assertNoSymlinks(path: string): void {
  let current = path;
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("P14 data paths must not contain symlinks");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
