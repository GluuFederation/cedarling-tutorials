import { describe, expect, it, vi } from "vitest";
import { authorizeDevice, parsePersona } from "../src/auth/device-flow.js";

const issuer = "http://idp.localhost:4000";

describe("P2 Device Flow helper", () => {
  it("announces verification and handles pending and slow-down polling", async () => {
    const responses = [
      Response.json({
        device_authorization_endpoint: `${issuer}/device/auth`,
        token_endpoint: `${issuer}/token`,
      }),
      Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: `${issuer}/device`,
        verification_uri_complete: `${issuer}/device?user_code=ABCD-EFGH`,
        expires_in: 600,
        interval: 1,
      }),
      Response.json({ error: "authorization_pending" }, { status: 400 }),
      Response.json({ error: "slow_down" }, { status: 400 }),
      Response.json({
        access_token: "short-lived-token",
        token_type: "Bearer",
        expires_in: 300,
      }),
    ];
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    });
    const sleep = vi.fn(async () => {});
    const onVerification = vi.fn();
    await expect(
      authorizeDevice({
        issuer,
        clientId: "p2-tenantrag-cli",
        resource: "http://p2.localhost:3000/api",
        persona: "mallory",
        fetch: request,
        sleep,
        onVerification,
      }),
    ).resolves.toBe("short-lived-token");
    expect(sleep.mock.calls).toEqual([[1_000], [1_000], [6_000]]);
    expect(onVerification).toHaveBeenCalledWith({
      userCode: "ABCD-EFGH",
      verificationUri: `${issuer}/device`,
      verificationUriComplete: `${issuer}/device?user_code=ABCD-EFGH`,
    });
    const deviceBody = request.mock.calls[1]?.[1]?.body;
    const parameters = new URLSearchParams(String(deviceBody));
    expect(parameters.get("login_hint")).toBe("mallory");
    expect(parameters.get("resource")).toBe("http://p2.localhost:3000/api");
    expect(parameters.get("scope")?.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "corpus.search",
      "document.retrieve",
    ]);
  });

  it("surfaces denial without returning a token", async () => {
    const responses = [
      Response.json({
        device_authorization_endpoint: `${issuer}/device/auth`,
        token_endpoint: `${issuer}/token`,
      }),
      Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: `${issuer}/device`,
        expires_in: 600,
        interval: 1,
      }),
      Response.json({ error: "access_denied" }, { status: 400 }),
    ];
    await expect(
      authorizeDevice({
        issuer,
        clientId: "p2-tenantrag-cli",
        resource: "http://p2.localhost:3000/api",
        persona: "ada",
        fetch: vi
          .fn<typeof fetch>()
          .mockImplementation(async () => responses.shift()!),
        sleep: async () => {},
        onVerification: () => {},
      }),
    ).rejects.toThrow("denied");
  });

  it.each([
    [
      "provider expiry",
      Response.json({ error: "expired_token" }, { status: 400 }),
      "expired",
    ],
    [
      "a malformed success response",
      Response.json({ token_type: "Bearer", expires_in: 300 }),
      "access_token",
    ],
  ])("rejects %s", async (_name, finalResponse, expectedMessage) => {
    const responses = [
      Response.json({
        device_authorization_endpoint: `${issuer}/device/auth`,
        token_endpoint: `${issuer}/token`,
      }),
      Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: `${issuer}/device`,
        expires_in: 600,
        interval: 1,
      }),
      finalResponse,
    ];
    await expect(
      authorizeDevice({
        issuer,
        clientId: "p2-tenantrag-cli",
        resource: "http://p2.localhost:3000/api",
        persona: "ada",
        fetch: vi
          .fn<typeof fetch>()
          .mockImplementation(async () => responses.shift()!),
        sleep: async () => {},
        onVerification: () => {},
      }),
    ).rejects.toThrow(expectedMessage);
  });

  it("surfaces identity-provider network failures", async () => {
    await expect(
      authorizeDevice({
        issuer,
        clientId: "p2-tenantrag-cli",
        resource: "http://p2.localhost:3000/api",
        persona: "ada",
        fetch: vi
          .fn<typeof fetch>()
          .mockRejectedValue(new Error("network unavailable")),
        onVerification: () => {},
      }),
    ).rejects.toThrow("network unavailable");
  });

  it("accepts only P2 personas", () => {
    expect(parsePersona("ada")).toBe("ada");
    expect(() => parsePersona("alex")).toThrow("ada, leo, or mallory");
  });
});
