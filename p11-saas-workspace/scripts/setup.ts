import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { loadConfig } from "../server/config/environment.ts";
import { AppDatabase } from "../server/data/database.ts";

const target = resolve(".env");
const identity = ensureProjectIdentity("P11");

function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .local/idp/.env`);
  return value;
}
const url = (name: string): string => required(name).replace(/\/$/u, "");

const baseUrl = url("P11_POST_LOGOUT_REDIRECT_URI");
if (url("P11_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P11 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const defaultDatabaseUrl = "postgresql://p11:p11@127.0.0.1:5435/p11";
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P11_DATABASE_URL:
      process.env.P11_DATABASE_URL?.trim() ||
      current.environment.P11_DATABASE_URL?.trim() ||
      defaultDatabaseUrl,
    P11_BASE_URL: baseUrl,
    P11_PORT:
      new URL(baseUrl).port || (baseUrl.startsWith("https:") ? "443" : "80"),
    P11_ISSUER: url("IDP_ISSUER"),
    P11_API_RESOURCE: url("P11_API_RESOURCE"),
    P11_CLIENT_ID: required("P11_CLIENT_ID"),
    P11_CLIENT_SECRET: required("P11_CLIENT_SECRET"),
  },
  defaults: {
    P11_HOST: "127.0.0.1",
    P11_SESSION_SECRET: randomBytes(32).toString("base64url"),
  },
});
const environment = { ...process.env, ...merged.environment };
const config = loadConfig(environment);
writePrivateEnvironment(target, merged.text);

if (config.databaseUrl === defaultDatabaseUrl) {
  const postgres = spawnSync(
    "docker",
    ["compose", "up", "-d", "--wait", "postgres"],
    { cwd: process.cwd(), stdio: "inherit" },
  );
  if (postgres.error) throw postgres.error;
  if (postgres.status !== 0) throw new Error("P11 PostgreSQL could not start");
}

const database = new AppDatabase(config.databaseUrl);
try {
  await database.initialize(config.issuer);
} finally {
  await database.close();
}
console.log(
  merged.synchronizedKeys.length
    ? `Synchronized P11 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P11 environment, migrations, and fixtures are ready",
);
