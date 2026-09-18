import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  P4_HOST: z.string().trim().min(1).default("127.0.0.1"),
  P4_PORT: z.coerce.number().int().min(1).max(65_535).default(3004),
  P4_BASE_URL: z.url().default("http://p4.localhost:3004"),
  P4_ISSUER: z.url().default("http://idp.localhost:4000"),
  P4_CLIENT_ID: z.string().trim().min(1).default("p4-editorial-publishing"),
  P4_CLIENT_SECRET: z.string().min(32),
  P4_API_RESOURCE: z.url().default("http://p4.localhost:3004/api"),
  P4_SESSION_SECRET: z.string().min(32),
  P4_DATA_DIR: z.string().trim().min(1).default(".local/p4-data"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(environment);
  const baseUrl = new URL(value.P4_BASE_URL);
  const issuer = new URL(value.P4_ISSUER);
  return {
    host: value.P4_HOST,
    port: value.P4_PORT,
    baseUrl: baseUrl.origin,
    issuer: issuer.origin,
    clientId: value.P4_CLIENT_ID,
    clientSecret: value.P4_CLIENT_SECRET,
    apiResource: new URL(value.P4_API_RESOURCE).toString().replace(/\/$/u, ""),
    sessionSecret: value.P4_SESSION_SECRET,
    dataDirectory: resolve(value.P4_DATA_DIR),
  };
}

export function prepareDataDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
