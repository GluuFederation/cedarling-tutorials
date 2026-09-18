import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/server/config.ts";
import { createTokenVerifier } from "../src/server/jwt.ts";

const config: ApiConfig = {
  host: "127.0.0.1",
  port: 3110,
  issuer: "http://idp.localhost:4000",
  apiResource: "http://p10.localhost:3010/api",
  dataDirectory: ".local/p10-data",
  workloadClientIds: {
    "transfer-planner": "custom-planner",
    "warehouse-north": "custom-north",
    "warehouse-south": "custom-south",
    "inventory-auditor": "custom-auditor",
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("workload access tokens", () => {
  it("binds a signed token to the configured client, audience, type, and scope", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "p10-test",
      alg: "RS256",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return new Response(
            JSON.stringify({
              issuer: config.issuer,
              jwks_uri: `${config.issuer}/jwks`,
            }),
          );
        }
        return new Response(JSON.stringify({ keys: [jwk] }));
      }),
    );
    const verifier = await createTokenVerifier(config);
    const valid = await new SignJWT({
      client_id: "custom-north",
      scope: "warehouse.api",
    })
      .setProtectedHeader({ alg: "RS256", kid: "p10-test", typ: "at+jwt" })
      .setIssuer(config.issuer)
      .setAudience(config.apiResource)
      .setSubject("custom-north")
      .setExpirationTime("2m")
      .sign(privateKey);
    await expect(verifier.verify(valid)).resolves.toEqual({
      workloadId: "warehouse-north",
    });

    const wrongType = await new SignJWT({
      client_id: "custom-north",
      scope: "warehouse.api",
    })
      .setProtectedHeader({ alg: "RS256", kid: "p10-test", typ: "JWT" })
      .setIssuer(config.issuer)
      .setAudience(config.apiResource)
      .setExpirationTime("2m")
      .sign(privateKey);
    await expect(verifier.verify(wrongType)).rejects.toThrow(
      "token_type_invalid",
    );
  });
});
