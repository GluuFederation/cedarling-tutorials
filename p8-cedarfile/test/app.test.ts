import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/server/app.ts";
import type { Session } from "../src/server/database.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import { createHarness, testTokens } from "./harness.ts";

const unavailableOidc: OidcRuntime = {
  authorizationUrl: async () => {
    throw new Error("not used");
  },
  exchange: async () => {
    throw new Error("not used");
  },
  refresh: async () => {
    throw new Error("not used");
  },
};

const running: Server[] = [];

afterEach(async () => {
  await Promise.all(
    running
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  vi.restoreAllMocks();
});

async function launch(oidc: OidcRuntime = unavailableOidc) {
  const harness = createHarness();
  const app = await buildApp({
    config: harness.config,
    sessions: harness.sessions,
    service: harness.service,
    oidc,
  });
  const server = createServer(app);
  running.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test address");
  return { harness, origin: `http://127.0.0.1:${address.port}` };
}

function credentials(
  harness: ReturnType<typeof createHarness>,
  userId = "user-jordan",
): { session: Session; cookie: string } {
  const created = harness.sessions.createSession(
    userId,
    testTokens,
    harness.config,
  );
  const session = harness.sessions.getSession(created.rawId, harness.config);
  if (!session) throw new Error("Test session was not persisted");
  return { session, cookie: `p8_session=${created.rawId}` };
}

function requestHeaders(
  harness: ReturnType<typeof createHarness>,
  auth: ReturnType<typeof credentials>,
): Record<string, string> {
  return {
    Cookie: auth.cookie,
    Origin: harness.config.baseUrl,
    "Sec-Fetch-Site": "same-origin",
    "X-CSRF-Token": auth.session.csrfToken,
  };
}

function fakeOidc(subject: string): OidcRuntime {
  return {
    authorizationUrl: async (transaction, loginHint) =>
      new URL(
        `http://idp.localhost:4000/auth?login_hint=${loginHint}&state=${transaction.state}`,
      ),
    exchange: async () => ({
      issuer: testTokens.issuer,
      subject,
      tokens: { ...testTokens, subject },
    }),
    refresh: async (tokens) => tokens,
  };
}

function cookiePair(response: Response, name: string): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,\\s]+)`));
  if (!match?.[1]) throw new Error(`Missing ${name} response cookie`);
  return `${name}=${match[1]}`;
}

describe("P8 HTTP boundary", () => {
  it("maps the OIDC callback to a bounded session and clears both cookies on logout", async () => {
    const { harness, origin } = await launch(fakeOidc("jordan"));
    try {
      const login = await fetch(`${origin}/auth/login?login_hint=jordan`, {
        redirect: "manual",
      });
      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toContain("login_hint=jordan");
      const transaction = cookiePair(login, "p8_oidc_transaction");

      const callback = await fetch(
        `${origin}/auth/callback?code=tutorial-code&state=tutorial-state`,
        {
          headers: { Cookie: transaction },
          redirect: "manual",
        },
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe("/");
      expect(callback.headers.get("set-cookie")).toContain(
        "p8_oidc_transaction=;",
      );
      const sessionCookie = cookiePair(callback, "p8_session");

      const current = await fetch(`${origin}/api/session`, {
        headers: { Cookie: sessionCookie },
      });
      expect(current.status).toBe(200);
      const session = (await current.json()) as {
        user: { id: string; name: string };
        csrfToken: string;
      };
      expect(session.user).toMatchObject({ id: "user-jordan", name: "Jordan" });

      const logout = await fetch(`${origin}/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
          Origin: harness.config.baseUrl,
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": session.csrfToken,
        },
      });
      expect(logout.status).toBe(204);
      expect(logout.headers.get("set-cookie")).toContain("p8_session=;");
      const afterLogout = await fetch(`${origin}/api/session`, {
        headers: { Cookie: sessionCookie },
      });
      expect(afterLogout.status).toBe(401);
    } finally {
      harness.close();
    }
  });

  it("rejects an authenticated identity outside the tutorial account map", async () => {
    const { harness, origin } = await launch(fakeOidc("external-user"));
    try {
      const login = await fetch(`${origin}/auth/login?login_hint=jordan`, {
        redirect: "manual",
      });
      const callback = await fetch(`${origin}/auth/callback?code=unmapped`, {
        headers: {
          Cookie: cookiePair(login, "p8_oidc_transaction"),
        },
        redirect: "manual",
      });
      expect(callback.status).toBe(403);
      await expect(callback.json()).resolves.toEqual({
        error: "unmapped_tutorial_identity",
      });
      expect(callback.headers.get("set-cookie")).toContain(
        "p8_oidc_transaction=;",
      );
      expect(callback.headers.get("set-cookie")).not.toContain("p8_session=");
    } finally {
      harness.close();
    }
  });

  it("fails closed and clears the session when token refresh fails", async () => {
    const oidc: OidcRuntime = {
      ...fakeOidc("jordan"),
      refresh: async () => {
        throw new Error("refresh rejected");
      },
    };
    const { harness, origin } = await launch(oidc);
    try {
      const created = harness.sessions.createSession(
        "user-jordan",
        {
          ...testTokens,
          accessTokenExpiresAt: Date.now() + 1_000,
        },
        harness.config,
      );
      const response = await fetch(`${origin}/api/session`, {
        headers: { Cookie: `p8_session=${created.rawId}` },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toContain("p8_session=;");
      expect(
        harness.sessions.getSession(created.rawId, harness.config),
      ).toBeUndefined();
    } finally {
      harness.close();
    }
  });
  it("requires authentication before resource metadata", async () => {
    const { harness, origin } = await launch();
    try {
      const response = await fetch(`${origin}/api/resources`);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      await expect(response.json()).resolves.toEqual({
        error: "authentication_required",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects missing CSRF and invalid names before the capability seam", async () => {
    const { harness, origin } = await launch();
    const auth = credentials(harness);
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const missingCsrf = await fetch(`${origin}/api/folders`, {
        method: "POST",
        headers: {
          Cookie: auth.cookie,
          Origin: harness.config.baseUrl,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parentId: "res_01K3ROOTAAAA", name: "Safe" }),
      });
      expect(missingCsrf.status).toBe(403);

      const traversal = await fetch(`${origin}/api/folders`, {
        method: "POST",
        headers: {
          ...requestHeaders(harness, auth),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parentId: "res_01K3ROOTAAAA",
          name: "../escape",
        }),
      });
      expect(traversal.status).toBe(400);
      expect(logs).not.toHaveBeenCalled();
      expect(harness.database.listChildren("res_01K3ROOTAAAA")).toHaveLength(3);
    } finally {
      harness.close();
    }
  });

  it("logs a sanitized seam and performs a validated creation", async () => {
    const { harness, origin } = await launch();
    const auth = credentials(harness);
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await fetch(`${origin}/api/folders`, {
        method: "POST",
        headers: {
          ...requestHeaders(harness, auth),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parentId: "res_01K3ROOTAAAA", name: "Review" }),
      });
      expect(response.status).toBe(201);
      expect(logs).toHaveBeenCalledWith(
        expect.stringContaining("P8 server | FAKE ALLOW | "),
      );
      const serialized = JSON.stringify(logs.mock.calls);
      expect(serialized).toContain("resource.create");
      expect(serialized).not.toContain(auth.cookie);
      expect(serialized).not.toContain(harness.root);
    } finally {
      harness.close();
    }
  });

  it("serves authenticated content with a selected type and safe headers", async () => {
    const { harness, origin } = await launch();
    const auth = credentials(harness, "user-lee");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const response = await fetch(
        `${origin}/api/resources/res_01K3VIEWAAAA/content`,
        { headers: { Cookie: auth.cookie } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-disposition")).toContain("inline");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      await expect(response.text()).resolves.toMatch(/shared with Lee/i);
    } finally {
      harness.close();
    }
  });
  it("requires the raw content type for upload and replacement", async () => {
    const { harness, origin } = await launch();
    const auth = credentials(harness);
    const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const headers = {
        ...requestHeaders(harness, auth),
        "Content-Type": "text/plain",
      };
      const upload = await fetch(
        `${origin}/api/files?parentId=res_01K3ROOTAAAA&name=wrong-type.txt`,
        { method: "POST", headers, body: "valid text" },
      );
      expect(upload.status).toBe(415);

      const original = harness.database.getResource("res_01K3PRIVATEA");
      if (!original) throw new Error("Missing fixture resource");
      const replace = await fetch(
        `${origin}/api/resources/${original.id}/content?version=${original.version}`,
        { method: "PUT", headers, body: "changed" },
      );
      expect(replace.status).toBe(415);
      expect(harness.storage.read(original.id).toString()).toMatch(/private/i);
      expect(logs).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });
});
