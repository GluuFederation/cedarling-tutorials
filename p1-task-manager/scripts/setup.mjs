import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import { loadConfig } from "../src/server/config.ts";

const target = resolve(".env");
const identity = ensureProjectIdentity("P1");
function required(name) {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`${name} is missing from .local/idp/.env`);
  return value;
}
const url = (name) => required(name).replace(/\/$/, "");

const baseUrl = url("P1_POST_LOGOUT_REDIRECT_URI");
if (url("P1_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
  throw new Error(
    "P1 redirect URI differs from its registered application origin",
  );

const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P1_BASE_URL: baseUrl,
    P1_PORT:
      new URL(baseUrl).port || (baseUrl.startsWith("https:") ? "443" : "80"),
    P1_ISSUER: url("IDP_ISSUER"),
    P1_API_RESOURCE: url("P1_API_RESOURCE"),
    P1_CLIENT_ID: required("P1_CLIENT_ID"),
    P1_CLIENT_SECRET: required("P1_CLIENT_SECRET"),
  },
  defaults: {
    P1_HOST: "127.0.0.1",
    P1_DATA_DIR: ".data",
    P1_SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  },
});
loadConfig(merged.environment);
writePrivateEnvironment(target, merged.text);
const policyStore = await buildPolicyStore({
  projectRoot: process.cwd(),
  dependencyRoot: fileURLToPath(new URL("..", import.meta.url)),
});
console.log(
  merged.synchronizedKeys.length
    ? `Synchronized P1 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "p1-task-manager/.env is already current",
);
console.log(
  `P1 policy store ${policyStore.version} | sha256 ${policyStore.sha256}`,
);
