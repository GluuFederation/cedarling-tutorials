import { afterEach, describe, expect, it } from "vitest";
import { McpClientSession } from "../src/mcp/client.js";
import { startTestApplication, type TestApplication } from "./helpers.js";

const applications: TestApplication[] = [];
afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

describe("MCP transport and resource authentication", () => {
  it("publishes protected-resource metadata and challenges a missing token", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const origin = new URL(application.endpoint).origin;
    const metadata = await fetch(
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: application.config.mcpResource,
      authorization_servers: [application.config.issuer],
      scopes_supported: ["mcp.access"],
    });

    const response = await fetch(application.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "resource_metadata",
    );
  });

  it("rejects invalid issuer, audience, client, scope, expiry, and subject", async () => {
    const application = await startTestApplication();
    applications.push(application);
    for (const token of [
      await application.token("amir", { issuer: "http://other.test" }),
      await application.token("amir", { audience: "http://other.test/mcp" }),
      await application.token("amir", { clientId: "other-client" }),
      await application.token("amir", { scope: "openid profile email" }),
      await application.token("amir", { expiresInSeconds: -1 }),
      await application.token("amir", { subject: "mallory" }),
    ]) {
      await expect(
        McpClientSession.connect({
          endpoint: application.endpoint,
          accessToken: token,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects protocol and routing-header mismatches", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const token = await application.token("dana");

    for (const [header, value] of [
      ["MCP-Protocol-Version", "2025-11-25"],
      ["Mcp-Method", "tools/call"],
    ] as const) {
      const tamperedFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set(header, value);
        return fetch(input, { ...init, headers });
      };
      await expect(
        McpClientSession.connect({
          endpoint: application.endpoint,
          accessToken: token,
          fetch: tamperedFetch,
        }),
      ).rejects.toThrow();
    }

    const nameTamperedFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Mcp-Name", "search_incidents");
      return fetch(input, { ...init, headers });
    };
    const nameMismatched = await McpClientSession.connect({
      endpoint: application.endpoint,
      accessToken: token,
      fetch: nameTamperedFetch,
    });
    await expect(
      nameMismatched.callToolDirect("list_capabilities", {}),
    ).rejects.toThrow();
    await nameMismatched.close();
  });
});
