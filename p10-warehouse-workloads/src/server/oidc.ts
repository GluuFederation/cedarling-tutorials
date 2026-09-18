import * as oidc from "openid-client";
import type { AgentConfig } from "./config.ts";

export interface WorkloadTokens {
  accessToken(): Promise<string>;
}

function discoveryOptions(issuer: URL) {
  const local =
    issuer.protocol === "http:" &&
    (issuer.hostname === "localhost" ||
      issuer.hostname === "127.0.0.1" ||
      issuer.hostname.endsWith(".localhost"));
  if (issuer.protocol === "http:" && !local) {
    throw new Error("Plain HTTP is restricted to loopback tutorial issuers");
  }
  return local ? { execute: [oidc.allowInsecureRequests] } : undefined;
}

export async function createWorkloadTokens(
  config: AgentConfig,
): Promise<WorkloadTokens> {
  const issuer = new URL(config.issuer);
  const client = await oidc.discovery(
    issuer,
    config.clientId,
    config.clientSecret,
    undefined,
    discoveryOptions(issuer),
  );
  let cached: { token: string; expiresAt: number } | undefined;
  return {
    async accessToken() {
      if (cached && cached.expiresAt > Date.now() + 15_000) return cached.token;
      const response = await oidc.clientCredentialsGrant(client, {
        resource: config.apiResource,
        scope: "warehouse.api",
      });
      const expiresIn = response.expiresIn();
      if (
        !response.access_token ||
        expiresIn === undefined ||
        !response.scope?.split(/\s+/u).includes("warehouse.api")
      ) {
        throw new Error("P10 workload token response is incomplete");
      }
      cached = {
        token: response.access_token,
        expiresAt: Date.now() + expiresIn * 1_000,
      };
      return cached.token;
    },
  };
}
