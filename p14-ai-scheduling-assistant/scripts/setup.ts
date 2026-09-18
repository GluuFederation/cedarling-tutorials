import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const target = resolve(".env");
const identityTarget = resolve("../shared/identity-provider/.env");
if (!existsSync(identityTarget))
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P14 setup",
  );
const identity = parseEnv(readFileSync(identityTarget, "utf8"));
const required = (name: string): string => {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
  return value;
};
const url = (name: string): string => required(name).replace(/\/$/u, "");
const baseUrl = url("P14_POST_LOGOUT_REDIRECT_URI");
if (url("P14_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P14 redirect URI differs from its registered application origin",
  );
const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P14_BASE_URL: baseUrl,
    P14_ISSUER: url("IDP_ISSUER"),
    P14_API_RESOURCE: url("P14_API_RESOURCE"),
    P14_CLIENT_ID: required("P14_CLIENT_ID"),
    P14_CLIENT_SECRET: required("P14_CLIENT_SECRET"),
  },
  defaults: {
    P14_HOST: "127.0.0.1",
    P14_PORT: "3014",
    P14_DATA_DIR: ".local/p14-data",
    P14_SESSION_ENCRYPTION_KEY:
      current.environment.P14_SESSION_ENCRYPTION_KEY ??
      randomBytes(32).toString("base64url"),
  },
});
const config = loadConfig(merged.environment);
prepareDataDirectory(config.dataDirectory);
new AppDatabase(
  resolve(config.dataDirectory, "schedule.sqlite"),
  config,
).close();
writePrivateEnvironment(target, merged.text);
console.info(
  merged.synchronizedKeys.length
    ? `Synchronized P14 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P14 configuration and SQLite fixtures are ready",
);
