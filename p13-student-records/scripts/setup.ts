import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig, prepareData } from "../src/server/config.ts";
import { SchoolDatabase } from "../src/server/database.ts";

export function setupProject(
  root = process.cwd(),
  identityFile = resolve(root, "../shared/identity-provider/.env"),
): void {
  const target = resolve(root, ".env");
  const current = readProjectEnvironment(target);
  if (!existsSync(identityFile))
    throw new Error(
      "Run pnpm --dir ../shared/identity-provider run setup before P13 setup",
    );
  const identity = parseEnv(readFileSync(identityFile, "utf8"));
  function required(name: string): string {
    const value = identity[name]?.trim();
    if (!value)
      throw new Error(`${name} is missing from shared/identity-provider/.env`);
    return value;
  }
  const url = (name: string): string => required(name).replace(/\/$/u, "");

  const baseUrl = url("P13_POST_LOGOUT_REDIRECT_URI");
  if (url("P13_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
    throw new Error(
      "P13 redirect URI differs from its registered application origin",
    );
  const issuer = url("IDP_ISSUER");
  const merged = mergeProjectEnvironment(current.text, {
    managed: {
      P13_BASE_URL: baseUrl,
      P13_ISSUER: issuer,
      P13_API_RESOURCE: url("P13_API_RESOURCE"),
      P13_CLIENT_ID: required("P13_CLIENT_ID"),
      P13_CLIENT_SECRET: required("P13_CLIENT_SECRET"),
    },
    defaults: {
      P13_HOST: "127.0.0.1",
      P13_PORT: new URL(baseUrl).port || "80",
      P13_IDP_PORT: new URL(issuer).port || "80",
      P13_DATA_DIR: ".local/p13-data",
    },
  });
  const config = loadConfig(merged.environment, root);
  writePrivateEnvironment(target, merged.text);
  const database = new SchoolDatabase(prepareData(config, root), config.issuer);
  database.close();
  console.info(
    merged.synchronizedKeys.length
      ? `Synchronized P13 environment keys: ${merged.synchronizedKeys.join(", ")}`
      : "P13 configuration and persisted fixtures are ready",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  try {
    setupProject();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "P13 setup failed");
    process.exitCode = 1;
  }
}
