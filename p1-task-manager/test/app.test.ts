import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilities } from "../src/shared/authorization.js";
import { buildApp } from "../src/server/app.js";
import type {
  AuthorizationTarget,
  ServerAuthorization,
} from "../src/server/authorization-trace.js";
import type { AppConfig } from "../src/server/config.js";
import { AppDatabase } from "../src/server/database.js";
import type { OidcRuntime, OidcTokens } from "../src/server/oidc.js";

const roots: string[] = [];

function tokenSet(overrides: Partial<OidcTokens> = {}): OidcTokens {
  const now = Date.now();
  return {
    issuer: "http://localhost:18001",
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
  authorizationUrl: async () => new URL("http://localhost:18001/auth"),
  exchange: async () => ({
    issuer: "http://localhost:18001",
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

function allowed(
  session: NonNullable<ReturnType<AppDatabase["getSession"]>>,
  target: AuthorizationTarget,
): boolean {
  const owner =
    session.user.role === "owner" && session.user.assuranceLevel >= 2;
  if (target.capability === capabilities.create)
    return owner && session.user.tenantId === target.tenantId;
  const related =
    session.user.id === target.task.ownerId ||
    session.user.id === target.task.assigneeId;
  const sameTenant = session.user.tenantId === target.task.tenantId;
  if (target.capability === capabilities.view) return sameTenant && related;
  if (target.capability === capabilities.edit) return sameTenant && related;
  if (target.capability === capabilities.assign)
    return (
      owner &&
      sameTenant &&
      session.user.id === target.task.ownerId &&
      target.requestedAssigneeTenantId === target.task.tenantId
    );
  if (target.capability === capabilities.complete)
    return owner && sameTenant && related;
  return owner && sameTenant && session.user.id === target.task.ownerId;
}

function authorizationRuntime(
  overrides: Partial<ServerAuthorization> = {},
): ServerAuthorization {
  const policy = {
    release: "p1@1.0.0",
    storeId: "p1",
    version: "1.0.0",
    sha256: "a".repeat(64),
    url: `/policy-store/${"a".repeat(64)}.cjar`,
  };
  const runtime: ServerAuthorization = {
    policy,
    authorize: vi.fn(
      async (
        _requestId: string,
        session: NonNullable<ReturnType<AppDatabase["getSession"]>>,
        target: AuthorizationTarget,
      ) => allowed(session, target),
    ),
    authorizeBatch: vi.fn(
      async (
        _requestId: string,
        session: NonNullable<ReturnType<AppDatabase["getSession"]>>,
        targets: readonly AuthorizationTarget[],
      ) => targets.map((target) => allowed(session, target)),
    ),
    envelope: ({
      session,
      tenantCreate,
      taskCeilings = {},
      tasks = [],
      now = Date.now(),
    }) => ({
      uiPrincipal: {
        id: session.user.id,
        tenantId: session.user.tenantId,
        role: session.user.role,
        assuranceLevel: session.user.assuranceLevel,
      },
      ceiling: {
        ...(tenantCreate === undefined
          ? {}
          : { tenant: { create: tenantCreate } }),
        tasks: taskCeilings,
      },
      policy,
      subjectEpoch: `epoch-${session.user.id}`,
      resourceVersions: Object.fromEntries(
        tasks.map((task) => [task.id, task.version]),
      ),
      evaluatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }),
    artifact: vi.fn(async (digest) =>
      digest === policy.sha256 ? new Uint8Array([1, 2, 3]) : undefined,
    ),
    close: vi.fn(async () => {}),
  };
  return { ...runtime, ...overrides };
}

async function fixture(
  userId: string,
  runtime: OidcRuntime = oidc,
  tokens: OidcTokens = tokenSet(),
  authorization: ServerAuthorization = authorizationRuntime(),
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
    port: 17001,
    baseUrl: "http://localhost:17001",
    dataDirectory: root,
    issuer: "http://localhost:18001",
    apiResource: "http://localhost:17001/api",
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
  const app = await buildApp({
    config,
    database,
    oidc: runtime,
    authorization,
    webRoot,
  });
  return {
    app,
    config,
    database,
    session,
    stored,
    authorization,
    cookie: `p1_session=${session.rawId}`,
  };
}

function mutationHeaders(cookie: string, csrfToken: string) {
  return {
    cookie,
    origin: "http://localhost:17001",
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
  it("filters navigation and direct reads through the same task.view rule", async () => {
    const { app, authorization, cookie } = await fixture("user-sam");
    const list = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().tasks.map((task: { id: string }) => task.id)).toEqual([
      "task-b-notes",
    ]);
    expect(list.json().authorization).toMatchObject({
      uiPrincipal: { id: "user-sam", tenantId: "tenant-b" },
      ceiling: { tenant: { create: false } },
      policy: { release: "p1@1.0.0" },
      resourceVersions: { "task-b-notes": 1 },
    });
    expect(JSON.stringify(list.json())).not.toMatch(
      /access-token|refresh-token|id-token|csrf|p1_session/i,
    );
    expect(authorization.authorizeBatch).toHaveBeenCalledOnce();
    const direct = await app.inject({
      method: "GET",
      url: "/api/tasks/task-a-brief",
      headers: { cookie },
    });
    expect(direct.statusCode).toBe(404);
    expect(direct.json()).toEqual({ error: "task_not_found" });
    await app.close();
  });

  it("fails closed without leaking partial data or applying effects", async () => {
    const failing = authorizationRuntime({
      authorize: vi.fn(async () => {
        throw new Error("private Cedarling failure");
      }),
      authorizeBatch: vi.fn(async () => {
        throw new Error("private Cedarling failure");
      }),
    });
    const { app, cookie, database, session } = await fixture(
      "user-mina",
      oidc,
      tokenSet(),
      failing,
    );
    const list = await app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { cookie },
    });
    expect(list.statusCode).toBe(503);
    expect(list.json()).toEqual({ error: "authorization_unavailable" });
    expect(JSON.stringify(list.json())).not.toContain("private Cedarling");

    const before = database.getTask("task-a-brief");
    const mutation = await app.inject({
      method: "PATCH",
      url: "/api/tasks/task-a-brief",
      headers: mutationHeaders(cookie, session.csrfToken),
      payload: { title: "Must not persist", description: "", version: 1 },
    });
    expect(mutation.statusCode).toBe(503);
    expect(database.getTask("task-a-brief")).toEqual(before);
    await app.close();
  });

  it("serves only registered content-addressed policy artifacts", async () => {
    const { app, authorization } = await fixture("user-alex");
    const current = await app.inject({
      method: "GET",
      url: authorization.policy.url,
    });
    expect(current.statusCode).toBe(200);
    expect(current.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    expect(current.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    const missing = await app.inject({
      method: "GET",
      url: `/policy-store/${"b".repeat(64)}.cjar`,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("requires valid CSRF, Origin, and Fetch Metadata for mutations", async () => {
    const { app, cookie, session } = await fixture("user-mina");
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

  it.each([1, 99])(
    "preserves non-leaking denials for submitted version %i",
    async (version) => {
      const { app, cookie, database, session } = await fixture("user-alex");
      const headers = mutationHeaders(cookie, session.csrfToken);
      const taskCount = database.listTasks("tenant-a").length;
      const create = await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers,
        payload: { title: "Denied", description: "" },
      });
      expect(create.statusCode).toBe(403);
      expect(create.json()).toEqual({ error: "forbidden" });
      expect(database.listTasks("tenant-a")).toHaveLength(taskCount);

      const complete = await app.inject({
        method: "POST",
        url: "/api/tasks/task-a-brief/complete",
        headers,
        payload: { version },
      });
      expect(complete.statusCode).toBe(404);
      expect(complete.json()).toEqual({ error: "task_not_found" });
      expect(database.getTask("task-a-brief")?.status).toBe("in-progress");
      await app.close();
    },
  );

  describe.each([
    {
      operation: "edit",
      method: "PATCH",
      suffix: "",
      userId: "user-alex",
      body: { title: "Unauthorized edit", description: "" },
    },
    {
      operation: "assign",
      method: "POST",
      suffix: "/assign",
      userId: "user-mina",
      body: { assigneeId: "user-alex" },
    },
    {
      operation: "complete",
      method: "POST",
      suffix: "/complete",
      userId: "user-mina",
      body: {},
    },
    {
      operation: "delete",
      method: "DELETE",
      suffix: "",
      userId: "user-mina",
      body: {},
    },
  ] as const)(
    "$operation snapshot binding",
    ({ method, suffix, userId, body }) => {
      it.each([1, 2])(
        "rejects submitted version %i when assignment changes during authorization",
        async (version) => {
          const authorization = authorizationRuntime();
          const { app, cookie, database, session } = await fixture(
            userId,
            oidc,
            tokenSet(),
            authorization,
          );
          const original = database.getTask("task-a-brief");
          vi.mocked(authorization.authorize).mockImplementation(
            async (_requestId, currentSession, target) => {
              const decision = allowed(currentSession, target);
              // Simulate Mina reassigning the task while Cedarling evaluates its old snapshot.
              database.assignTask("task-a-brief", 1, "user-mina");
              return decision;
            },
          );
          try {
            const response = await app.inject({
              method,
              url: `/api/tasks/task-a-brief${suffix}`,
              headers: mutationHeaders(cookie, session.csrfToken),
              payload: { ...body, version },
            });
            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({ error: "stale_task_version" });
            expect(database.getTask("task-a-brief")).toEqual({
              ...original,
              assigneeId: "user-mina",
              version: 2,
              updatedAt: expect.any(String),
            });
          } finally {
            await app.close();
          }
        },
      );
    },
  );

  it("rejects a repeated completion without changing task state", async () => {
    const { app, cookie, session } = await fixture("user-mina");
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
    const { app, cookie, session } = await fixture("user-mina");
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
    const { app, cookie, session } = await fixture("user-mina");
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks/task-a-brief/assign",
      headers: {
        cookie,
        origin: "http://localhost:17001",
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
        return new URL("http://localhost:18001/auth");
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
