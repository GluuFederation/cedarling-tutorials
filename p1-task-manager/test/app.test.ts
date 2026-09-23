import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/server/app.js";
import type { AppConfig } from "../src/server/config.js";
import { AppDatabase } from "../src/server/database.js";
import type { OidcRuntime, OidcTokens } from "../src/server/oidc.js";

const roots: string[] = [];

function tokenSet(overrides: Partial<OidcTokens> = {}): OidcTokens {
  const now = Date.now();
  return {
    issuer: "http://idp.localhost:4000",
    subject: "alex",
    accessToken: "access-token",
    accessTokenExpiresAt: now + 300_000,
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: now + 1_200_000,
    idToken: "id-token",
    idTokenExpiresAt: now + 300_000,
    tokenType: "Bearer",
    scope: "openid profile email offline_access task.view",
    ...overrides,
  };
}

const oidc: OidcRuntime = {
  authorizationUrl: async () => new URL("http://idp.localhost:4000/auth"),
  exchange: async () => ({
    issuer: "http://idp.localhost:4000",
    subject: "alex",
    tokens: tokenSet(),
  }),
  refresh: async (tokens) =>
    tokenSet({
      ...tokens,
      accessToken: "refreshed-access-token",
      accessTokenExpiresAt: Date.now() + 300_000,
    }),
};

async function fixture(
  userId: string,
  runtime: OidcRuntime = oidc,
  tokens: OidcTokens = tokenSet(),
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p1-app-"));
  roots.push(root);
  const webRoot = path.join(root, "web");
  fs.mkdirSync(webRoot);
  fs.writeFileSync(
    path.join(webRoot, "index.html"),
    "<!doctype html><title>P1</title>",
  );
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3000,
    baseUrl: "http://p1.localhost:3000",
    dataDirectory: root,
    issuer: "http://idp.localhost:4000",
    apiResource: "http://p1.localhost:3000/api",
    clientId: "p1-task-manager",
    clientSecret: "x".repeat(32),
    sessionEncryptionKey: Buffer.alloc(32, 7),
  };
  const database = new AppDatabase(
    path.join(root, "test.sqlite"),
    config.issuer,
  );
  const session = database.createSession(userId, tokens, config);
  const stored = database.getSession(session.rawId, config);
  const app = await buildApp({ config, database, oidc: runtime, webRoot });
  return {
    app,
    config,
    database,
    session,
    stored,
    cookie: `p1_session=${session.rawId}`,
  };
}

function mutationHeaders(cookie: string, csrfToken: string) {
  return {
    cookie,
    origin: "http://p1.localhost:3000",
    "sec-fetch-site": "same-origin",
    "x-csrf-token": csrfToken,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("P1 HTTP boundary", () => {
  it("keeps normal navigation tenant scoped while preserving the exact permissive IDOR", async () => {
    const { app, cookie } = await fixture("user-sam");
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});
    const list = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().tasks.map((task: { id: string }) => task.id)).toEqual([
      "task-b-notes",
    ]);
    expect(trace).toHaveBeenCalledOnce();
    expect(trace).toHaveBeenCalledWith(
      expect.stringContaining("P1 server | FAKE ALLOW"),
    );
    expect(trace).toHaveBeenCalledWith(
      "P1 server | FAKE ALLOW | task.view | user-sam -> TaskCollection::tenant-b",
    );
    expect(JSON.stringify(trace.mock.calls)).not.toMatch(
      /access-token|refresh-token|id-token|p1_session/,
    );
    const direct = await app.inject({
      method: "GET",
      url: "/api/tasks/task-a-brief",
      headers: { cookie },
    });
    expect(direct.statusCode).toBe(200);
    expect(direct.json()).toMatchObject({
      task: { id: "task-a-brief", tenantId: "tenant-a" },
    });
    await app.close();
  });

  it("requires valid CSRF, Origin, and Fetch Metadata for mutations", async () => {
    const { app, cookie, session } = await fixture("user-alex");
    const valid = mutationHeaders(cookie, session.csrfToken);
    const rejectedHeaders = [
      {
        cookie,
        origin: valid.origin,
        "sec-fetch-site": valid["sec-fetch-site"],
      },
      { ...valid, "x-csrf-token": "wrong-token" },
      { ...valid, origin: "http://attacker.invalid" },
      { ...valid, "sec-fetch-site": "cross-site" },
    ];

    for (const headers of rejectedHeaders) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/tasks/task-a-brief/complete",
        headers,
        payload: { version: 1 },
      });
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json()).toEqual({
        error: "request_verification_failed",
      });
    }

    const accepted = await app.inject({
      method: "POST",
      url: "/api/tasks/task-a-brief/complete",
      headers: valid,
      payload: { version: 1 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      task: { id: "task-a-brief", status: "completed" },
    });
    await app.close();
  });

  it("rejects a repeated completion without changing task state", async () => {
    const { app, cookie, session } = await fixture("user-alex");
    const headers = mutationHeaders(cookie, session.csrfToken);
    const first = await app.inject({
      method: "POST",
      url: "/api/tasks/task-a-brief/complete",
      headers,
      payload: { version: 1 },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().task).toMatchObject({
      status: "completed",
      version: 2,
    });

    const repeated = await app.inject({
      method: "POST",
      url: "/api/tasks/task-a-brief/complete",
      headers,
      payload: { version: 2 },
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toEqual({ error: "invalid_task_transition" });

    const current = await app.inject({
      method: "GET",
      url: "/api/tasks/task-a-brief",
      headers: { cookie },
    });
    expect(current.json().task).toMatchObject({
      status: "completed",
      version: 2,
    });
    await app.close();
  });

  it("persists create, edit, assign, and delete effects through the HTTP boundary", async () => {
    const { app, cookie, session } = await fixture("user-mina");
    const headers = mutationHeaders(cookie, session.csrfToken);
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers,
      payload: {
        title: "Publish P1",
        description: "Verify every task effect.",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().task).toMatchObject({
      tenantId: "tenant-a",
      ownerId: "user-mina",
      title: "Publish P1",
      version: 1,
    });
    const taskId = String(created.json().task.id);

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers,
      payload: {
        title: "Publish verified P1",
        description: "Verify every task effect.",
        version: 1,
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().task).toMatchObject({
      title: "Publish verified P1",
      version: 2,
    });

    const assigned = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/assign`,
      headers,
      payload: { assigneeId: "user-alex", version: 2 },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().task).toMatchObject({
      assigneeId: "user-alex",
      version: 3,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${taskId}`,
      headers,
      payload: { version: 3 },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/tasks/${taskId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("prevents authenticated responses from being cached", async () => {
    const { app, cookie, session } = await fixture("user-alex");
    const headers = mutationHeaders(cookie, session.csrfToken);
    const responses = [
      await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie },
      }),
      await app.inject({
        method: "GET",
        url: "/api/tasks",
        headers: { cookie },
      }),
      await app.inject({
        method: "GET",
        url: "/api/tasks/task-a-brief",
        headers: { cookie },
      }),
      await app.inject({
        method: "PATCH",
        url: "/api/tasks/task-a-brief",
        headers,
        payload: { title: "Stale", description: "", version: 99 },
      }),
      await app.inject({ method: "POST", url: "/auth/logout", headers }),
    ];

    for (const response of responses) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    await app.close();
  });

  it("returns only domain errors for rejected mutations", async () => {
    const { app, cookie, session } = await fixture("user-alex");
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks/task-a-brief/assign",
      headers: {
        cookie,
        origin: "http://p1.localhost:3000",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": session.csrfToken,
      },
      payload: { assigneeId: "user-mina", version: 9 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stale_task_version" });
    await app.close();
  });

  it("publishes all six capability-to-route mappings", async () => {
    const { app } = await fixture("user-alex");
    const document = (
      await app.inject({ method: "GET", url: "/openapi.json" })
    ).json();

    expect({
      viewCollection:
        document.paths["/api/tasks"].get["x-cedarling-capability"],
      create: document.paths["/api/tasks"].post["x-cedarling-capability"],
      view: document.paths["/api/tasks/{id}"].get["x-cedarling-capability"],
      edit: document.paths["/api/tasks/{id}"].patch["x-cedarling-capability"],
      assign:
        document.paths["/api/tasks/{id}/assign"].post["x-cedarling-capability"],
      complete:
        document.paths["/api/tasks/{id}/complete"].post[
          "x-cedarling-capability"
        ],
      delete:
        document.paths["/api/tasks/{id}"].delete["x-cedarling-capability"],
    }).toEqual({
      viewCollection: "task.view",
      create: "task.create",
      view: "task.view",
      edit: "task.edit",
      assign: "task.assign",
      complete: "task.complete",
      delete: "task.delete",
    });
    await app.close();
  });

  it("forwards an allowed login hint to the OIDC authorization request", async () => {
    const receivedLoginHints: string[] = [];
    const hintedOidc: OidcRuntime = {
      ...oidc,
      authorizationUrl: async (_transaction, loginHint: string) => {
        receivedLoginHints.push(loginHint);
        return new URL("http://idp.localhost:4000/auth");
      },
    };
    const { app } = await fixture("user-alex", hintedOidc);

    expect(
      (await app.inject({ method: "GET", url: "/auth/login?login_hint=mina" }))
        .statusCode,
    ).toBe(302);
    expect(
      (await app.inject({ method: "GET", url: "/auth/login" })).statusCode,
    ).toBe(302);
    expect(receivedLoginHints).toEqual(["mina", "alex"]);

    const rejected = await app.inject({
      method: "GET",
      url: "/auth/login?login_hint=unknown",
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: "invalid_tutorial_login_hint" });
    await app.close();
  });

  it("refreshes an expiring access token once without extending the app session", async () => {
    let releaseRefresh: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refresh = vi.fn(async (tokens: OidcTokens) => {
      await refreshStarted;
      return tokenSet({
        ...tokens,
        accessToken: "rotated-access-token",
        accessTokenExpiresAt: Date.now() + 300_000,
        refreshToken: "rotated-refresh-token",
        refreshTokenExpiresAt: Date.now() + 1_200_000,
      });
    });
    const runtime: OidcRuntime = { ...oidc, refresh };
    const originalTokens = tokenSet({
      accessTokenExpiresAt: Date.now() + 25_000,
    });
    const { app, config, cookie, database, session, stored } = await fixture(
      "user-alex",
      runtime,
      originalTokens,
    );

    const first = Promise.resolve(
      app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie },
      }),
    );
    const second = Promise.resolve(
      app.inject({ method: "GET", url: "/api/tasks", headers: { cookie } }),
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    releaseRefresh?.();
    const responses = await Promise.all([first, second]);

    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    expect(refresh).toHaveBeenCalledOnce();
    const refreshed = database.getSession(session.rawId, config);
    expect(refreshed?.tokens.accessToken).toBe("rotated-access-token");
    expect(refreshed?.tokens.refreshToken).toBe("rotated-refresh-token");
    expect(refreshed?.expiresAt).toBe(stored?.expiresAt);
    await app.close();
  });

  it("deletes the session and clears its cookie when refresh fails", async () => {
    const runtime: OidcRuntime = {
      ...oidc,
      refresh: async () => {
        throw new Error("raw token endpoint failure");
      },
    };
    const { app, config, cookie, database, session } = await fixture(
      "user-alex",
      runtime,
      tokenSet({ accessTokenExpiresAt: Date.now() + 25_000 }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "authentication_required" });
    expect(response.headers["set-cookie"]).toContain("p1_session=;");
    expect(database.getSession(session.rawId, config)).toBeUndefined();
    await app.close();
  });

  it("returns only UI-required session data and never serializes credentials", async () => {
    const { app, cookie, database } = await fixture("user-alex");
    const response = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        id: "user-alex",
        name: "Alex Morgan",
        tenantId: "tenant-a",
        role: "contributor",
        assuranceLevel: 1,
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /issuer|subject|accessToken|refreshToken|idToken/,
    );
    const stored = database.raw
      .prepare("SELECT encrypted_tokens FROM sessions")
      .get() as { encrypted_tokens: string };
    expect(stored.encrypted_tokens).not.toContain("access-token");
    expect(stored.encrypted_tokens).not.toContain("refresh-token");
    expect(stored.encrypted_tokens).not.toContain("id-token");
    await app.close();
  });
});
