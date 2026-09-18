import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

const client = {};
const oidc = vi.hoisted(() => ({
  discovery: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  authorizationCodeGrant: vi.fn(),
  refreshTokenGrant: vi.fn(),
}));

vi.mock("openid-client", () => ({
  ...oidc,
  allowInsecureRequests: Symbol("allowInsecureRequests"),
}));

import { createOidcRuntime, p1ApiScopes } from "../src/server/oidc.js";

const config: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  baseUrl: "http://p1.localhost:3000",
  dataDirectory: "/tmp/p1-oidc-test",
  issuer: "http://idp.localhost:4000",
  apiResource: "http://p1.localhost:3000/api",
  clientId: "p1-task-manager",
  clientSecret: "x".repeat(32),
  sessionEncryptionKey: Buffer.alloc(32),
};

function response(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    access_token: "access-token",
    expiresIn: () => 300,
    id_token: "id-token",
    refresh_token: "refresh-token",
    scope: p1ApiScopes.join(" "),
    token_type: "Bearer",
    claims: () => ({
      iss: config.issuer,
      sub: "alex",
      exp: Math.floor(Date.now() / 1_000) + 300,
    }),
    ...overrides,
  };
}

describe("P1 OIDC runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    oidc.discovery.mockResolvedValue(client);
    oidc.calculatePKCECodeChallenge.mockResolvedValue("pkce-challenge");
    oidc.buildAuthorizationUrl.mockReturnValue(
      new URL("http://idp.localhost:4000/auth"),
    );
    oidc.authorizationCodeGrant.mockResolvedValue(response());
  });

  it("requests the consented OIDC and P1 API evidence at both endpoints", async () => {
    const runtime = await createOidcRuntime(config);
    const transaction = {
      state: "state",
      nonce: "nonce",
      verifier: "verifier",
    };

    await runtime.authorizationUrl(transaction, "mina");
    expect(oidc.buildAuthorizationUrl).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        login_hint: "mina",
        prompt: "login consent",
        resource: config.apiResource,
        scope: [
          "openid",
          "profile",
          "email",
          "offline_access",
          ...p1ApiScopes,
        ].join(" "),
      }),
    );

    await runtime.exchange(
      new URL("http://p1.localhost:3000/auth/callback?code=code"),
      transaction,
    );
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
      client,
      expect.any(URL),
      expect.objectContaining({
        expectedNonce: "nonce",
        expectedState: "state",
        pkceCodeVerifier: "verifier",
      }),
      { resource: config.apiResource },
    );
  });

  it("retains an omitted refresh token and replaces a rotated one", async () => {
    const runtime = await createOidcRuntime(config);
    const original = {
      issuer: config.issuer,
      subject: "alex",
      accessToken: "old-access-token",
      accessTokenExpiresAt: Date.now() + 10_000,
      refreshToken: "original-refresh-token",
      refreshTokenExpiresAt: Date.now() + 900_000,
      idToken: "old-id-token",
      idTokenExpiresAt: Date.now() + 10_000,
      tokenType: "Bearer",
      scope: p1ApiScopes.join(" "),
    };
    oidc.refreshTokenGrant
      .mockResolvedValueOnce(
        response({
          access_token: "first-refreshed-access-token",
          refresh_token: undefined,
        }),
      )
      .mockResolvedValueOnce(
        response({
          access_token: "second-refreshed-access-token",
          refresh_token: "rotated-refresh-token",
        }),
      );

    const retained = await runtime.refresh(original);
    expect(retained.refreshToken).toBe("original-refresh-token");
    expect(retained.refreshTokenExpiresAt).toBe(original.refreshTokenExpiresAt);
    expect(oidc.refreshTokenGrant).toHaveBeenLastCalledWith(
      client,
      "original-refresh-token",
      { resource: config.apiResource },
    );

    const rotated = await runtime.refresh(retained);
    expect(rotated.refreshToken).toBe("rotated-refresh-token");
    expect(rotated.refreshTokenExpiresAt).toBeGreaterThan(
      retained.refreshTokenExpiresAt,
    );
  });
});
