import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { resolve } from "node:path";

import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";

const target = resolve(".env");
const identity = ensureProjectIdentity("P3");
const required = (name) => {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`.local/idp/.env is missing ${name}`);
  return value;
};
const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P3_ISSUER: required("IDP_ISSUER").replace(/\/$/, ""),
    P3_CLIENT_ID: required("P3_CLIENT_ID"),
    P3_MCP_RESOURCE: required("P3_MCP_RESOURCE").replace(/\/$/, ""),
  },
  defaults: {
    P3_HOST: "127.0.0.1",
    P3_PORT: "17003",
    P3_PROVIDER_TIMEOUT_MS: "15000",
  },
});
writePrivateEnvironment(target, merged.text);
console.log(
  `Synchronized ${merged.synchronizedKeys.join(", ") || "no"} environment keys.`,
);
