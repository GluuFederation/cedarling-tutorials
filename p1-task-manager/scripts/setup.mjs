import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";

const target = resolve(".env");
const identityTarget = resolve("../shared/identity-provider/.env");
if (!existsSync(identityTarget))
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P1 setup",
  );

const identity = parseEnv(readFileSync(identityTarget, "utf8"));
function required(name) {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
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
    P1_ISSUER: url("IDP_ISSUER"),
    P1_API_RESOURCE: url("P1_API_RESOURCE"),
    P1_CLIENT_ID: required("P1_CLIENT_ID"),
    P1_CLIENT_SECRET: required("P1_CLIENT_SECRET"),
  },
  defaults: {
    P1_HOST: "127.0.0.1",
    P1_PORT: "3000",
    P1_DATA_DIR: ".data",
    P1_SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  },
});
writePrivateEnvironment(target, merged.text);
console.log(
  merged.synchronizedKeys.length
    ? `Synchronized P1 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "p1-task-manager/.env is already current",
);
