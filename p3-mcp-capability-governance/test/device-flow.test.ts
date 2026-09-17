import { describe, expect, it, vi } from "vitest";
import { authorizeDevice } from "../src/auth/device-flow.js";

describe("P3 Device Flow", () => {
  it("binds both requests to the MCP resource and polls without leaking a token", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const responses = [
      new Response(
        JSON.stringify({
          device_authorization_endpoint: "http://idp.test/device/auth",
          token_endpoint: "http://idp.test/token",
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "http://idp.test/device",
          expires_in: 600,
          interval: 1,
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 400,
      }),
      new Response(
        JSON.stringify({
          access_token: "access-secret",
          token_type: "Bearer",
          expires_in: 1800,
        }),
        { status: 200 },
      ),
    ];
    const request = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body;
        const serializedBody =
          typeof body === "string"
            ? body
            : body instanceof URLSearchParams
              ? body.toString()
              : undefined;
        calls.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          ...(serializedBody ? { body: serializedBody } : {}),
        });
        return responses.shift()!;
      },
    );

    const token = await authorizeDevice({
      issuer: "http://idp.test",
      clientId: "p3-client",
      resource: "http://p3.test/mcp",
      persona: "amir",
      fetch: request,
      sleep: async () => undefined,
      onVerification: () => undefined,
    });

    expect(token).toBe("access-secret");
    expect(calls[1]!.body).toContain("resource=http%3A%2F%2Fp3.test%2Fmcp");
    expect(calls[1]!.body).toContain("scope=openid+profile+email+mcp.access");
    expect(calls[2]!.body).toContain("resource=http%3A%2F%2Fp3.test%2Fmcp");
    expect(calls[1]!.body).toContain("login_hint=amir");
  });
});
