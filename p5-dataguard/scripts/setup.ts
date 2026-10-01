import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const target = resolve(".env");
const identity = ensureProjectIdentity("P5");
const required = (name: string): string => {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .local/idp/.env`);
  return value;
};
const url = (name: string): string => required(name).replace(/\/$/u, "");
const baseUrl = url("P5_POST_LOGOUT_REDIRECT_URI");
if (url("P5_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P5 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P5_BASE_URL: baseUrl,
    P5_PORT:
      new URL(baseUrl).port || (baseUrl.startsWith("https:") ? "443" : "80"),
    P5_ISSUER: url("IDP_ISSUER"),
    P5_API_RESOURCE: url("P5_API_RESOURCE"),
    P5_CLIENT_ID: required("P5_CLIENT_ID"),
    P5_CLIENT_SECRET: required("P5_CLIENT_SECRET"),
  },
  defaults: {
    P5_HOST: "127.0.0.1",
    P5_DATA_DIR: ".data",
    P5_SESSION_ENCRYPTION_KEY:
      current.environment.P5_SESSION_ENCRYPTION_KEY ??
      randomBytes(32).toString("base64url"),
  },
});
const config = loadConfig(merged.environment);
new AppDatabase(
  resolve(config.dataDirectory, "p5.sqlite"),
  config.issuer,
  resolve(config.dataDirectory, "exports"),
).close();
writePrivateEnvironment(target, merged.text);
await buildPolicyStore({
  projectRoot: resolve("."),
  dependencyRoot: resolve("."),
});
console.info(
  merged.synchronizedKeys.length
    ? `Synchronized P5 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P5 configuration and SQLite fixtures are ready",
);
