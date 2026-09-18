import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { Database } from "../src/server/database.ts";

const target = resolve(".env");
const identityTarget = resolve("../shared/identity-provider/.env");
if (!existsSync(identityTarget))
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P12 setup",
  );
const identity = parseEnv(readFileSync(identityTarget, "utf8"));

function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
  return value;
}
const url = (name: string): string => required(name).replace(/\/$/u, "");

const baseUrl = url("P12_POST_LOGOUT_REDIRECT_URI");
if (url("P12_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P12 redirect URI differs from its registered application origin",
  );

const issuer = url("IDP_ISSUER");
const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P12_BASE_URL: baseUrl,
    P12_ISSUER: issuer,
    P12_API_RESOURCE: url("P12_API_RESOURCE"),
    P12_CLIENT_ID: required("P12_CLIENT_ID"),
    P12_CLIENT_SECRET: required("P12_CLIENT_SECRET"),
  },
  defaults: {
    P12_HOST: "127.0.0.1",
    P12_PORT: new URL(baseUrl).port || "80",
    P12_IDP_PORT:
      new URL(issuer).port ||
      (new URL(issuer).protocol === "https:" ? "443" : "80"),
    P12_DATA_DIR: ".local/p12-data",
  },
});
const config = loadConfig(merged.environment);
prepareDataDirectory(config.dataDir);
writePrivateEnvironment(target, merged.text);
const database = new Database(resolve(config.dataDir, "hr.sqlite"));
database.close();
console.info(
  merged.synchronizedKeys.length
    ? `Synchronized P12 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P12 configuration and SQLite fixtures are ready",
);
