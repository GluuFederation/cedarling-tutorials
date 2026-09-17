import { loadGovernanceCatalog } from "./catalog/catalog.js";
import type { P3Config } from "./config/project-config.js";
import { createTokenVerifier } from "./auth/token-verifier.js";
import { createApp } from "./app.js";

export async function createRuntime(config: P3Config) {
  const catalog = await loadGovernanceCatalog(
    config.accPath,
    config.bindingPath,
  );
  return createApp({
    config,
    catalog,
    tokenVerifier: createTokenVerifier({
      issuer: config.issuer,
      audience: config.mcpResource,
      clientId: config.clientId,
    }),
  });
}
