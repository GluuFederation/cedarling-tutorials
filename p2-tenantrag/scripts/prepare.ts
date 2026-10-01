/** Prepare local identity, configuration, and policies without calling AI providers. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../../shared/identity-provider/scripts/project-environment.mjs";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import { p2TrustConfiguration } from "../src/config/project-config.js";

const target = resolve(".env");
const identity = ensureProjectIdentity("P2");
function required(name: string): string {
  const value = identity[name]?.trim();
  if (!value) throw new Error(`.local/idp/.env is missing ${name}`);
  return value;
}
const trust = p2TrustConfiguration({
  issuer: required("IDP_ISSUER"),
  apiResource: required("P2_API_RESOURCE"),
});
const origin = new URL(trust.apiResource);
const current = readProjectEnvironment(target);
const merged = mergeProjectEnvironment(current.text, {
  managed: {
    P2_BASE_URL: origin.origin,
    P2_PORT: origin.port,
    P2_ISSUER: trust.issuer,
    P2_CLIENT_ID: required("P2_CLIENT_ID"),
    P2_API_RESOURCE: trust.apiResource,
  },
});
writePrivateEnvironment(target, merged.text);
const policyStore = await buildPolicyStore({
  projectRoot: process.cwd(),
  dependencyRoot: fileURLToPath(new URL("..", import.meta.url)),
});
console.info(
  `Synchronized ${merged.synchronizedKeys.join(", ") || "no"} environment keys.`,
);
console.info(
  `P2 policy store ${policyStore.version} | sha256 ${policyStore.sha256}`,
);
