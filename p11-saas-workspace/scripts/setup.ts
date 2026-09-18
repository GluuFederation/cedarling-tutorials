import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const target = resolve(".env");
const identityTarget = resolve("../shared/identity-provider/.env");
if (!existsSync(identityTarget))
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P11 setup",
  );
const identity = parseEnv(readFileSync(identityTarget, "utf8"));

function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
  return value;
}
const url = (name: string): string => required(name).replace(/\/$/u, "");

const baseUrl = url("P11_POST_LOGOUT_REDIRECT_URI");
if (url("P11_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P11 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P11_BASE_URL: baseUrl,
    P11_ISSUER: url("IDP_ISSUER"),
    P11_API_RESOURCE: url("P11_API_RESOURCE"),
    P11_CLIENT_ID: required("P11_CLIENT_ID"),
    P11_CLIENT_SECRET: required("P11_CLIENT_SECRET"),
  },
  defaults: {
    P11_HOST: "127.0.0.1",
    P11_PORT: "3011",
    P11_DATABASE_URL: "postgresql://p11:p11@127.0.0.1:5435/p11",
    P11_SESSION_SECRET: randomBytes(32).toString("base64url"),
  },
});
const environment = { ...process.env, ...merged.environment };
loadConfig(environment);
writePrivateEnvironment(target, merged.text);

const postgres = spawnSync(
  "docker",
  ["compose", "up", "-d", "--wait", "postgres"],
  { cwd: process.cwd(), stdio: "inherit" },
);
if (postgres.error) throw postgres.error;
if (postgres.status !== 0) throw new Error("P11 PostgreSQL could not start");

const config = loadConfig(environment);
const database = new AppDatabase(config.databaseUrl);
try {
  await database.migrate();
  const count = await database.pool.query<{ count: string }>(
    "SELECT count(*) count FROM principals",
  );
  if (Number(count.rows[0]?.count) === 0) await database.seed();
} finally {
  await database.close();
}
console.log(
  merged.synchronizedKeys.length
    ? `Synchronized P11 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P11 environment, migrations, and fixtures are ready",
);
