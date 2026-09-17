import { afterEach, expect, test } from "vitest";
import { buildApp } from "../src/server/app.ts";
import type { AppConfig } from "../src/server/config.ts";
import { SchoolDatabase } from "../src/server/database.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import type { SessionView } from "../src/shared/contracts.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function setup(
  authorizationMode: "permissive" | "unavailable" = "permissive",
) {
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3013,
    baseUrl: "http://127.0.0.1:3013",
    issuer: "http://idp.localhost:4000",
    apiResource: "http://127.0.0.1:3013/api",
    clientId: "p13",
    clientSecret: "test-only-secret-that-is-long-enough",
    dataDir: ".local/test-unused",
  };
  const database = new SchoolDatabase(":memory:", config.issuer);
  const oidc: OidcRuntime = {
    async authorizationUrl(transaction, hint) {
      return new URL(
        `${config.baseUrl}/auth/callback?code=${hint}&state=${transaction.state}`,
      );
    },
    async exchange(url, transaction) {
      if (url.searchParams.get("state") !== transaction.state)
        throw new Error("Wrong state");
      return {
        issuer: config.issuer,
        subject: url.searchParams.get("code") ?? "",
        expiresAt: Date.now() + 60000,
      };
    },
  };
  const server = buildApp({
    config,
    database,
    oidc,
    ...(authorizationMode === "unavailable"
      ? { authorize: async () => "unavailable" as const }
      : {}),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  config.baseUrl = `http://127.0.0.1:${address.port}`;
  const cookies = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set(
      "Cookie",
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
    const response = await fetch(new URL(path, config.baseUrl), {
      ...init,
      headers,
      redirect: "manual",
    });
    for (const entry of response.headers.getSetCookie()) {
      const pair = entry.split(";")[0] ?? "";
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return response;
  }
  async function login(subject = "talia"): Promise<SessionView> {
    const start = await request(`/auth/login?login_hint=${subject}`);
    const location = start.headers.get("location");
    if (!location) throw new Error("No callback");
    expect((await request(location)).status).toBe(302);
    const response = await request("/api/session");
    return (await response.json()) as SessionView;
  }
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
  });
  return { config, database, cookies, request, login };
}

test("real HTTP boundary requires a session and CSRF, then exposes only the requested audience", async () => {
  const app = await setup();
  expect((await app.request("/api/grades/teacher/grade-sam-1")).status).toBe(
    401,
  );
  const session = await app.login("grace");
  const own = await app.request("/api/grades/guardian/grade-sam-1");
  expect(await own.json()).toMatchObject({ grade: { letterGrade: "B" } });
  expect(
    (
      await app.request("/api/grades/grade-sam-1/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      })
    ).status,
  ).toBe(403);
  const response = await app.request("/api/grades/grade-sam-1/publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app.config.baseUrl,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: "grade-sam-1",
    state: "published",
    version: 2,
  });
});

test("expired sessions and replayed callbacks cannot release a grade", async () => {
  const app = await setup();
  const start = await app.request("/auth/login?login_hint=talia");
  const callback = start.headers.get("location");
  if (!callback) throw new Error("Missing callback");
  const login = await app.request(callback);
  expect(login.status).toBe(302);
  expect(login.headers.getSetCookie().join(";")).toContain("HttpOnly");
  expect(login.headers.getSetCookie().join(";")).toContain("SameSite=Lax");
  expect((await app.request(callback)).status).toBe(400);
  app.database.sql.exec("UPDATE sessions SET expires_at=0");
  expect((await app.request("/api/grades/teacher/grade-sam-1")).status).toBe(
    401,
  );
});

test("wrong callback state consumes the transaction without creating a session", async () => {
  const app = await setup();
  const start = await app.request("/auth/login?login_hint=talia");
  const callback = new URL(start.headers.get("location") ?? "");
  callback.searchParams.set("state", "wrong");
  expect((await app.request(callback.toString())).status).toBe(400);
  expect((await app.request("/api/session")).status).toBe(401);
  expect(
    app.database.sql.prepare("SELECT COUNT(*) count FROM sessions").get(),
  ).toEqual({ count: 0 });
});

test.each([
  { id: "talia", name: "Talia", role: "teacher" },
  { id: "sam", name: "Sam Rivera", role: "student" },
  { id: "grace", name: "Grace", role: "guardian" },
])("the $id identity retains its seeded name and audience", async (user) => {
  const app = await setup();
  expect((await app.login(user.id)).user).toEqual(user);
});

test("a negative-fixture actor cannot sign in through a hint or valid callback", async () => {
  const app = await setup();
  expect((await app.request("/auth/login?login_hint=rene")).status).toBe(400);
  const start = await app.request("/auth/login?login_hint=talia");
  const callback = new URL(start.headers.get("location") ?? "");
  callback.searchParams.set("code", "rene");
  expect((await app.request(callback.toString())).status).toBe(400);
  expect((await app.request("/api/session")).status).toBe(401);
  expect(
    app.database.sql.prepare("SELECT COUNT(*) count FROM sessions").get(),
  ).toEqual({ count: 0 });
});

test("input and cross-origin failures preserve the draft and return sanitized no-store errors", async () => {
  const app = await setup();
  const session = await app.login();
  const headers = {
    "Content-Type": "application/json",
    Origin: app.config.baseUrl,
    "X-CSRF-Token": session.csrfToken,
  };
  const input = {
    expectedVersion: 1,
    score: 80,
    feedback: "New feedback",
    internalNote: "Private",
  };
  const cases = [
    { body: "{invalid", status: 400, headers },
    {
      body: JSON.stringify({ ...input, extra: "unexpected" }),
      status: 400,
      headers,
    },
    { body: JSON.stringify({ ...input, score: 101 }), status: 400, headers },
    {
      body: JSON.stringify({ ...input, feedback: "x".repeat(18000) }),
      status: 413,
      headers,
    },
    {
      body: JSON.stringify(input),
      status: 403,
      headers: { ...headers, Origin: "http://attacker.localhost:3013" },
    },
    {
      body: JSON.stringify(input),
      status: 415,
      headers: { ...headers, "Content-Type": "text/plain" },
    },
  ];
  for (const attempt of cases) {
    const response = await app.request("/api/grades/grade-sam-1", {
      method: "PATCH",
      body: attempt.body,
      headers: attempt.headers,
    });
    expect(response.status).toBe(attempt.status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(body).not.toContain("Private");
    expect(body).not.toContain("stack");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  }
  expect(app.database.snapshot("talia", "grade-sam-1")?.grade.version).toBe(1);
});

test("unavailable authorization returns no collection, detail or mutation payload", async () => {
  const app = await setup("unavailable");
  const session = await app.login();
  for (const path of [
    "/api/grades/teacher",
    "/api/grades/teacher/grade-sam-1",
  ]) {
    const response = await app.request(path);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internalNote");
  }
  const response = await app.request("/api/grades/grade-sam-1/publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app.config.baseUrl,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  expect(response.status).toBe(503);
  const update = await app.request("/api/grades/grade-sam-1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: app.config.baseUrl,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({
      expectedVersion: 1,
      score: 88,
      feedback: "No release",
      internalNote: "",
    }),
  });
  expect(update.status).toBe(503);
  expect(app.database.snapshot("talia", "grade-sam-1")?.grade).toMatchObject({
    state: "draft",
    version: 1,
    publishedAt: null,
  });
});

test("logout requires CSRF and invalidates the old session", async () => {
  const app = await setup();
  const session = await app.login();
  expect((await app.request("/auth/logout", { method: "POST" })).status).toBe(
    403,
  );
  expect((await app.request("/api/session")).status).toBe(200);
  const old = app.cookies.get("p13_session");
  expect(
    (
      await app.request("/auth/logout", {
        method: "POST",
        headers: {
          Origin: app.config.baseUrl,
          "X-CSRF-Token": session.csrfToken,
        },
      })
    ).status,
  ).toBe(204);
  if (old) app.cookies.set("p13_session", old);
  expect((await app.request("/api/session")).status).toBe(401);
});
