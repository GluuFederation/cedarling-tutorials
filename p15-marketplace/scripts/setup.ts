import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig } from "../src/server/config.ts";
import { prepareData } from "../src/server/prepare-data.ts";

export function setup() {
  const target = resolve(".env");
  const identityTarget = resolve("../shared/identity-provider/.env");
  if (!existsSync(identityTarget))
    throw new Error(
      "Run pnpm --dir ../shared/identity-provider run setup before P15 setup",
    );
  const identity = parseEnv(readFileSync(identityTarget, "utf8"));
  function required(name: string): string {
    const value = identity[name]?.trim();
    if (!value)
      throw new Error(`${name} is missing from shared/identity-provider/.env`);
    return value;
  }
  const url = (name: string): string => required(name).replace(/\/$/u, "");

  const baseUrl = url("P15_POST_LOGOUT_REDIRECT_URI");
  if (url("P15_REDIRECT_URI") !== `${baseUrl}/auth/callback`)
    throw new Error(
      "P15 redirect URI differs from its registered application origin",
    );
  const current = readProjectEnvironment(target);
  const merged = mergeProjectEnvironment(current.text, {
    managed: {
      P15_BASE_URL: baseUrl,
      P15_ISSUER: url("IDP_ISSUER"),
      P15_API_RESOURCE: url("P15_API_RESOURCE"),
      P15_CLIENT_ID: required("P15_CLIENT_ID"),
      P15_CLIENT_SECRET: required("P15_CLIENT_SECRET"),
    },
    defaults: {
      P15_HOST: "127.0.0.1",
      P15_PORT: "3015",
      P15_DATA_DIR: ".local/p15-data",
    },
  });
  const config = loadConfig(merged.environment);
  prepareData(config.dataDir);
  writePrivateEnvironment(target, merged.text);
  console.info(
    merged.synchronizedKeys.length
      ? `Synchronized P15 environment keys: ${merged.synchronizedKeys.join(", ")}`
      : "P15 setup complete; existing refund state preserved",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  setup();
