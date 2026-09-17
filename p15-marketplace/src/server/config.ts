import { isAbsolute, relative, resolve } from "node:path";

export type Config = ReturnType<typeof loadConfig>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = localUrl(env.P15_BASE_URL ?? "http://p15.localhost:3015");
  const issuer = localUrl(env.P15_ISSUER ?? "http://idp.localhost:4000");
  const host = env.P15_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "::1", "0.0.0.0"].includes(host))
    throw new Error("P15_HOST must use a local or container bind address");
  const port = integer(env.P15_PORT ?? "3015", 1, 65535);
  if (Number(baseUrl.port || 80) !== port)
    throw new Error("P15_BASE_URL and P15_PORT disagree");
  const clientSecret = env.P15_CLIENT_SECRET;
  if (!clientSecret || clientSecret.length < 32)
    throw new Error("Run setup after configuring the shared P15 client secret");
  const dataDir = resolve(env.P15_DATA_DIR ?? ".local/p15-data");
  const localRoot = resolve(".local");
  const child = relative(localRoot, dataDir);
  if (
    dataDir !== "/data" &&
    (!child || child.startsWith("..") || isAbsolute(child))
  )
    throw new Error(
      "P15_DATA_DIR must be a child of this project's .local or container /data",
    );
  return {
    baseUrl: baseUrl.origin,
    issuer: issuer.origin,
    host,
    port,
    dataDir,
    clientId: env.P15_CLIENT_ID ?? "p15-marketplace",
    clientSecret,
    apiResource: env.P15_API_RESOURCE ?? `${baseUrl.origin}/api`,
  } as const;
}
function localUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !(
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost")
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("P15 is a loopback-only local tutorial");
  return url;
}
function integer(value: unknown, min: number, max: number): number {
  const number =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  )
    throw new Error("Invalid bounded integer");
  return number;
}
