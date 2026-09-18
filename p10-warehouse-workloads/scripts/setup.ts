import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadApiConfig, prepareDataDirectory } from "../src/server/config.ts";
import { WarehouseDatabase } from "../src/server/database.ts";
import { WORKLOADS, workloadEnvironmentPrefix } from "../src/shared/catalog.ts";

const target = resolve(".env");
const identityTarget = resolve("../shared/identity-provider/.env");
if (!existsSync(identityTarget)) {
  throw new Error(
    "Run pnpm --dir ../shared/identity-provider run setup before P10 setup",
  );
}
const identity = parseEnv(readFileSync(identityTarget, "utf8"));
const required = (name: string): string => {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`${name} is missing from shared/identity-provider/.env`);
  return value;
};
const current = readProjectEnvironment(target);
const controlSecret =
  current.environment.P10_CONTROL_SECRET?.trim() ||
  randomBytes(32).toString("base64url");
const managed = Object.fromEntries(
  WORKLOADS.flatMap(({ id }) => {
    const name = workloadEnvironmentPrefix(id);
    return [
      [`${name}_CLIENT_ID`, required(`${name}_CLIENT_ID`)],
      [`${name}_CLIENT_SECRET`, required(`${name}_CLIENT_SECRET`)],
    ];
  }),
);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P10_ISSUER: required("IDP_ISSUER").replace(/\/$/u, ""),
    P10_API_RESOURCE: required("P10_API_RESOURCE").replace(/\/$/u, ""),
    ...managed,
  },
  defaults: {
    P10_HOST: "127.0.0.1",
    P10_PORT: "3010",
    P10_BASE_URL: "http://p10.localhost:3010",
    P10_API_HOST: "127.0.0.1",
    P10_API_PORT: "3110",
    P10_DATA_DIR: ".local/p10-data",
    P10_WAREHOUSE_API_URL: "http://127.0.0.1:3110",
    P10_TRANSFER_PLANNER_URL: "http://127.0.0.1:3111",
    P10_WAREHOUSE_NORTH_URL: "http://127.0.0.1:3112",
    P10_WAREHOUSE_SOUTH_URL: "http://127.0.0.1:3113",
    P10_INVENTORY_AUDITOR_URL: "http://127.0.0.1:3114",
    P10_CONTROL_SECRET: controlSecret,
  },
});
const config = loadApiConfig(merged.environment);
prepareDataDirectory(config.dataDirectory);
new WarehouseDatabase(
  resolve(config.dataDirectory, "warehouse.sqlite"),
).close();
writePrivateEnvironment(target, merged.text);
console.info(
  merged.synchronizedKeys.length
    ? `Synchronized P10 environment keys: ${merged.synchronizedKeys.join(", ")}`
    : "P10 configuration and SQLite fixtures are ready",
);
