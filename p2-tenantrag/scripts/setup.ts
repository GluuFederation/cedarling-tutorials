import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { loadConfig } from "../src/config/project-config.js";
import { loadProjectEnvironment } from "../src/config/environment.js";
import { setupProject } from "../src/rag/setup.js";

const projectEnvironment = resolve(".env");
const identityEnvironment = resolve("../shared/identity-provider/.env");
if (!existsSync(identityEnvironment)) {
  throw new Error(
    "Shared identity-provider/.env is required; run its setup first",
  );
}

const identity = parseEnv(readFileSync(identityEnvironment, "utf8"));
const requiredIdentityValue = (name: string): string => {
  const value = identity[name]?.trim();
  if (!value)
    throw new Error(`Shared identity-provider/.env is missing ${name}`);
  return value;
};
const normalizedUrl = (value: string): string => value.replace(/\/$/, "");
const current = readProjectEnvironment(projectEnvironment);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P2_ISSUER: normalizedUrl(requiredIdentityValue("IDP_ISSUER")),
    P2_CLIENT_ID: requiredIdentityValue("P2_CLIENT_ID"),
    P2_API_RESOURCE: normalizedUrl(requiredIdentityValue("P2_API_RESOURCE")),
  },
});
writePrivateEnvironment(projectEnvironment, merged.text);

loadProjectEnvironment();
const config = loadConfig();
const { recordCount, selectedModel } = await setupProject(config);
console.log(
  `Synchronized ${merged.synchronizedKeys.join(", ") || "no"} environment keys.`,
);
console.log(`Verified five PDFs and built ${recordCount} vector records.`);
console.log(`OpenRouter free-model smoke selected ${selectedModel}.`);
