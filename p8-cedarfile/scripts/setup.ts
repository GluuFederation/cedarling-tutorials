import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import { SafeStorage } from "../src/server/storage.ts";

const target = resolve(".env");
const identity = ensureProjectIdentity("P8");

function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .local/idp/.env`);
  return value;
}
const url = (name: string): string => required(name).replace(/\/$/u, "");

const baseUrl = url("P8_POST_LOGOUT_REDIRECT_URI");
if (url("P8_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P8 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P8_BASE_URL: baseUrl,
    P8_ISSUER: url("IDP_ISSUER"),
    P8_API_RESOURCE: url("P8_API_RESOURCE"),
    P8_CLIENT_ID: required("P8_CLIENT_ID"),
    P8_CLIENT_SECRET: required("P8_CLIENT_SECRET"),
  },
  defaults: {
    P8_HOST: "127.0.0.1",
    P8_PORT: "17008",
    P8_DATA_ROOT: ".local/p8-data",
    P8_SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  },
});
const config = loadConfig({ ...process.env, ...merged.environment });
writePrivateEnvironment(target, merged.text);
mkdirSync(config.dataRoot, { recursive: true, mode: 0o700 });
const storage = new SafeStorage(config.dataRoot);
const database = new AppDatabase(
  databasePath(config.dataRoot),
  config.issuer,
  storage,
);
database.close();
console.log(
  merged.synchronizedKeys.length
    ? `Synchronized P8 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P8 environment and deterministic workspace are ready",
);
