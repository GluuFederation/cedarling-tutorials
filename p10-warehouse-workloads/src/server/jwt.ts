import { createRemoteJWKSet, jwtVerify } from "jose";
import type { WorkloadId } from "../shared/catalog.ts";
import type { ApiConfig } from "./config.ts";

export type WorkloadPrincipal = Readonly<{
  workloadId: WorkloadId;
}>;

export interface TokenVerifier {
  verify(token: string): Promise<WorkloadPrincipal>;
}

export async function createTokenVerifier(
  config: ApiConfig,
): Promise<TokenVerifier> {
  const clientWorkloads = new Map<string, WorkloadId>(
    Object.entries(config.workloadClientIds).map(([workloadId, clientId]) => [
      clientId,
      workloadId as WorkloadId,
    ]),
  );
  const response = await fetch(
    `${config.issuer}/.well-known/openid-configuration`,
    {
      signal: AbortSignal.timeout(2_000),
    },
  );
  if (!response.ok) throw new Error("P10 issuer discovery failed");
  const metadata = (await response.json()) as {
    issuer?: unknown;
    jwks_uri?: unknown;
  };
  if (
    metadata.issuer !== config.issuer ||
    typeof metadata.jwks_uri !== "string"
  ) {
    throw new Error("P10 issuer metadata is invalid");
  }
  const jwksUrl = new URL(metadata.jwks_uri);
  if (jwksUrl.origin !== new URL(config.issuer).origin) {
    throw new Error("P10 issuer JWKS must use the issuer origin");
  }
  const keySet = createRemoteJWKSet(jwksUrl, {
    timeoutDuration: 2_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 5 * 60_000,
  });
  return {
    async verify(token) {
      if (token.length > 16_384) throw new Error("token_invalid");
      const { payload, protectedHeader } = await jwtVerify(token, keySet, {
        issuer: config.issuer,
        audience: config.apiResource,
        algorithms: ["RS256"],
      });
      if (protectedHeader.typ !== "at+jwt") {
        throw new Error("token_type_invalid");
      }
      const clientId =
        typeof payload.client_id === "string" ? payload.client_id : payload.sub;
      const scopes =
        typeof payload.scope === "string" ? payload.scope.split(/\s+/u) : [];
      const workloadId = clientId ? clientWorkloads.get(clientId) : undefined;
      if (!clientId || !workloadId || !scopes.includes("warehouse.api")) {
        throw new Error("token_claims_invalid");
      }
      return { workloadId };
    },
  };
}
