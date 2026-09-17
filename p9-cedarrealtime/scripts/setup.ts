import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";

const target = resolve(".env");
const identityTarget = resolve("../shared/identity-provider/.env");
if (!existsSync(identityTarget))
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P9 setup",
  );
const identity = parseEnv(readFileSync(identityTarget, "utf8"));

function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
  return value;
}
const url = (name: string): string => required(name).replace(/\/$/u, "");

const baseUrl = url("P9_POST_LOGOUT_REDIRECT_URI");
if (url("P9_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P9 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P9_BASE_URL: baseUrl,
    P9_ISSUER: url("IDP_ISSUER"),
    P9_API_RESOURCE: url("P9_API_RESOURCE"),
    P9_CLIENT_ID: required("P9_CLIENT_ID"),
    P9_CLIENT_SECRET: required("P9_CLIENT_SECRET"),
  },
  defaults: {
    P9_HOST: "127.0.0.1",
    P9_PORT: "3009",
    P9_DATA_ROOT: ".local/p9-data",
    P9_SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  },
});
const config = loadConfig({ ...process.env, ...merged.environment });
writePrivateEnvironment(target, merged.text);
mkdirSync(config.dataRoot, { recursive: true, mode: 0o700 });
const database = new AppDatabase(databasePath(config.dataRoot), config.issuer);
database.close();
console.log(
  merged.synchronizedKeys.length
    ? `Synchronized P9 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P9 environment and deterministic chat topology are ready",
);
