export type AppConfig = Readonly<{
  host: string;
  port: number;
  baseUrl: string;
  databaseUrl: string;
  issuer: string;
  apiResource: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  production: boolean;
}>;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function url(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required`);
  const parsed = new URL(value);
  const local =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".localhost");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error(`${name} must use HTTPS or tutorial loopback HTTP`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? "17011");
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("P11_PORT must be a valid TCP port");
  }
  return parsed;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (value.length < 32) throw new Error(`${name} must contain 32 characters`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.P11_HOST?.trim() || "127.0.0.1",
    port: port(env.P11_PORT),
    baseUrl: url(env, "P11_BASE_URL", "http://localhost:17011"),
    databaseUrl: required(env, "P11_DATABASE_URL"),
    issuer: url(env, "P11_ISSUER", "http://localhost:18011"),
    apiResource: url(env, "P11_API_RESOURCE", "http://localhost:17011/api"),
    clientId: env.P11_CLIENT_ID?.trim() || "p11-saas-workspace",
    clientSecret: secret(env, "P11_CLIENT_SECRET"),
    sessionSecret: secret(env, "P11_SESSION_SECRET"),
    production: env.NODE_ENV === "production",
  };
}
