import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type AppConfig = {
  host: string;
  port: number;
  baseUrl: string;
  issuer: string;
  apiResource: string;
  clientId: string;
  clientSecret: string;
  dataDir: string;
};

function localUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.hostname.endsWith(".localhost"))
  )
    throw new Error(
      `${name} must use a local tutorial URL without credentials`,
    );
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${name} has an unsupported protocol`);
  return url;
}

export function containedDataDir(value: string, root = process.cwd()): string {
  const localRoot = resolve(root, ".local");
  const target = resolve(root, value);
  const child = relative(localRoot, target);
  if (
    !child ||
    child.startsWith(`..${sep}`) ||
    child === ".." ||
    isAbsolute(child)
  )
    throw new Error(
      "P13_DATA_DIR must be a child of this project's .local directory",
    );
  let cursor = target;
  while (cursor !== dirname(cursor)) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error("P13 data paths must not contain symlinks");
    if (cursor === resolve(root)) break;
    cursor = dirname(cursor);
  }
  return target;
}

export function prepareData(config: AppConfig, root = process.cwd()): string {
  const directory = containedDataDir(config.dataDir, root);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory)
    throw new Error("P13 data directory changed during setup");
  for (const file of [
    "school.sqlite",
    "school.sqlite-wal",
    "school.sqlite-shm",
  ]) {
    const path = resolve(directory, file);
    const status = lstatSync(path, { throwIfNoEntry: false });
    if (
      status &&
      (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1)
    )
      throw new Error("P13 database files must be single-link regular files");
  }
  return resolve(directory, "school.sqlite");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
): AppConfig {
  const port = Number(env.P13_PORT ?? 3013);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("P13_PORT must be a TCP port");
  const host = env.P13_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "0.0.0.0"].includes(host))
    throw new Error("P13_HOST must use a local or container bind address");
  const base = localUrl(
    env.P13_BASE_URL ?? "http://p13.localhost:3013",
    "P13_BASE_URL",
  );
  if (
    base.pathname !== "/" ||
    Number(base.port || (base.protocol === "https:" ? 443 : 80)) !== port
  )
    throw new Error("P13_BASE_URL must match P13_PORT and have no path");
  const issuer = localUrl(
    env.P13_ISSUER ?? "http://idp.localhost:4000",
    "P13_ISSUER",
  );
  if (issuer.pathname !== "/")
    throw new Error("P13_ISSUER must be the local issuer origin");
  const apiResource = env.P13_API_RESOURCE ?? `${base.origin}/api`;
  if (apiResource !== `${base.origin}/api`)
    throw new Error("P13_API_RESOURCE must match the application API");
  const clientSecret = env.P13_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret.length < 32)
    throw new Error(
      "P13_CLIENT_SECRET must contain at least 32 characters; run setup",
    );
  return {
    host,
    port,
    baseUrl: base.origin,
    issuer: issuer.origin,
    apiResource,
    clientId: env.P13_CLIENT_ID ?? "p13-student-records",
    clientSecret,
    dataDir: containedDataDir(env.P13_DATA_DIR ?? ".local/p13-data", root),
  };
}
