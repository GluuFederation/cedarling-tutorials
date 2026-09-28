import type { P3Config } from "./config/project-config.js";
import { createTokenVerifier } from "./auth/token-verifier.js";
import { createApp } from "./app.js";

export function createRuntime(config: P3Config) {
  return createApp({
    config,
    tokenVerifier: createTokenVerifier({
      issuer: config.issuer,
      audience: config.mcpResource,
      clientId: config.clientId,
    }),
  });
}
