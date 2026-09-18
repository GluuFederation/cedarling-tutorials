import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/server/app.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import { createHarness } from "./harness.ts";

afterEach(() => vi.restoreAllMocks());

describe("HTTP session boundary", () => {
  it("exposes only bounded session data and protects ticket creation with CSRF", async () => {
    const harness = createHarness();
    const oidc: OidcRuntime = {
      async authorizationUrl() {
        return new URL("http://idp.localhost:4000/authorize");
      },
      async exchange() {
        throw new Error("not used");
      },
      async refresh(tokens) {
        return tokens;
      },
    };
    const { app } = await buildApp({
      config: harness.config,
      sessions: harness.sessions,
      chat: harness.database.chat,
      oidc,
      authorization: harness.authorization,
      webRoot: "/missing-p9-web-root",
    });
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test port");
    const origin = `http://127.0.0.1:${address.port}`;
    const session = harness.session("user-mei");
    const cookie = `p9_session=${session.rawId}`;
    try {
      const view = await fetch(`${origin}/api/session`, {
        headers: { Cookie: cookie },
      });
      expect(view.status).toBe(200);
      const body = (await view.json()) as Record<string, unknown>;
      expect(JSON.stringify(body)).not.toContain("test-access-token");
      expect(body).toMatchObject({ authzMode: "permissive" });

      const rejected = await fetch(`${origin}/api/connection-ticket`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: harness.config.baseUrl },
      });
      expect(rejected.status).toBe(403);
      const accepted = await fetch(`${origin}/api/connection-ticket`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: harness.config.baseUrl,
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": session.csrfToken,
        },
      });
      expect(accepted.status).toBe(201);
      expect(await accepted.json()).toMatchObject({
        ticket: expect.any(String),
      });

      const login = await fetch(`${origin}/auth/login?login_hint=mei`, {
        redirect: "manual",
      });
      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe(
        "http://idp.localhost:4000/authorize",
      );
      expect(login.headers.get("set-cookie")).not.toContain(
        "test-access-token",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      harness.close();
    }
  });
});
