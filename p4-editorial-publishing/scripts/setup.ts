import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const root = resolve(import.meta.dirname, "..");
await buildPolicyStore({ projectRoot: root, dependencyRoot: root });
const target = resolve(root, ".env");
const identity = ensureProjectIdentity("P4", resolve(root, ".local/idp/.env"));

function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .local/idp/.env`);
  return value;
}
const url = (name: string): string => required(name).replace(/\/$/u, "");
const baseUrl = url("P4_POST_LOGOUT_REDIRECT_URI");
if (url("P4_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P4 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P4_BASE_URL: baseUrl,
    P4_PORT:
      new URL(baseUrl).port || (baseUrl.startsWith("https:") ? "443" : "80"),
    P4_ISSUER: url("IDP_ISSUER"),
    P4_CLIENT_ID: required("P4_CLIENT_ID"),
    P4_CLIENT_SECRET: required("P4_CLIENT_SECRET"),
    P4_API_RESOURCE: url("P4_API_RESOURCE"),
  },
  defaults: {
    P4_HOST: "127.0.0.1",
    P4_DATA_DIR: ".local/p4-data",
    P4_SESSION_SECRET: randomBytes(32).toString("base64url"),
  },
});
const environment = { ...process.env, ...merged.environment };
const config = loadConfig(environment);
prepareDataDirectory(config.dataDirectory);
new AppDatabase(config.dataDirectory, config.issuer).close();
writePrivateEnvironment(target, merged.text);
console.info(
  merged.synchronizedKeys.length
    ? `Synchronized P4 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P4 environment and editorial fixtures are ready",
);
