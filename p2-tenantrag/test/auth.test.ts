import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../src/auth/authenticator.js";

const issuer = "http://idp.localhost:4000";
const audience = "http://p2.localhost:3000/api";
let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;

function createTestAuthenticator() {
  const diagnostics = vi.fn();
  return {
    diagnostics,
    authenticator: createAuthenticator({
      issuer,
      audience,
      keySet,
      diagnostics,
    }),
  };
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  Object.assign(jwk, { alg: "RS256", kid: "p2-test", use: "sig" });
  keySet = createLocalJWKSet({ keys: [jwk] } as JSONWebKeySet);
});

async function token(
  subject: string,
  overrides: Readonly<{
    issuer?: string;
    audience?: string;
    expiresIn?: string;
  }> = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "p2-test" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
}

describe("P2 bearer authentication", () => {
  it("accepts a valid mapped P2 subject", async () => {
    const { authenticator, diagnostics } = createTestAuthenticator();
    const accessToken = await token("ada");
    await expect(
      authenticator.authenticate(`Bearer ${accessToken}`),
    ).resolves.toEqual({ id: "ada", accessToken });
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["malformed", "Basic credential"],
    ["unknown subject", async () => `Bearer ${await token("alex")}`],
    [
      "wrong issuer",
      async () =>
        `Bearer ${await token("ada", { issuer: "https://wrong.example" })}`,
    ],
    [
      "wrong audience",
      async () =>
        `Bearer ${await token("ada", { audience: "https://wrong.example" })}`,
    ],
    [
      "expired",
      async () => `Bearer ${await token("ada", { expiresIn: "-1s" })}`,
    ],
  ])("rejects %s bearer evidence", async (_name, value) => {
    const header = typeof value === "function" ? await value() : value;
    const { authenticator, diagnostics } = createTestAuthenticator();
    await expect(authenticator.authenticate(header)).rejects.toMatchObject({
      statusCode: 401,
      code: "authentication_required",
    });
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith({
      event: "authentication_rejected",
      reason: expect.any(String),
    });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("Bearer");
  });

  it("rejects an invalid signature", async () => {
    const other = await generateKeyPair("RS256");
    const invalid = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "p2-test" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("ada")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    const { authenticator, diagnostics } = createTestAuthenticator();
    await expect(
      authenticator.authenticate(`Bearer ${invalid}`),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith({
      event: "authentication_rejected",
      reason: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(invalid);
  });
});
