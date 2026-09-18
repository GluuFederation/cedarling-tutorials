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
if (!existsSync(identityTarget)) {
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P7 setup",
  );
}
const identity = parseEnv(readFileSync(identityTarget, "utf8"));
const required = (name: string): string => {
  const value = identity[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
  }
  return value;
};
const url = (name: string): string => required(name).replace(/\/$/u, "");
const baseUrl = url("P7_POST_LOGOUT_REDIRECT_URI");
if (url("P7_REDIRECT_URI") !== `${baseUrl}/auth/callback`) {
  throw new Error(
    "P7 redirect URI differs from its registered application origin",
  );
}
const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P7_BASE_URL: baseUrl,
    P7_ISSUER: url("IDP_ISSUER"),
    P7_API_RESOURCE: url("P7_API_RESOURCE"),
    P7_CLIENT_ID: required("P7_CLIENT_ID"),
    P7_CLIENT_SECRET: required("P7_CLIENT_SECRET"),
  },
  defaults: {
    P7_HOST: "127.0.0.1",
    P7_PORT: new URL(baseUrl).port || "80",
    P7_DATA_DIR: ".local/p7-data",
  },
});
const config = loadConfig(merged.environment);
prepareDataDirectory(config.dataDirectory);
const database = new AppDatabase(
  resolve(config.dataDirectory, "documents.sqlite"),
  config.issuer,
);
database.close();
writePrivateEnvironment(target, merged.text);
console.info(
  merged.synchronizedKeys.length
    ? `Synchronized P7 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P7 configuration and SQLite fixtures are ready",
);
