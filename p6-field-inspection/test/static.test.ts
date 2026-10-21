import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { fakeAuthorization } from "../src/server/authorization.ts";
import type { Config } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const directories: string[] = [];
const applications: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

async function buildFixture(webRoot: string, version: string) {
  const scriptPath = `/assets/index-${version}.js`;
  const stylePath = `/assets/index-${version}.css`;
  const script = `document.getElementById("root").textContent = "${version}";`;
  const style = `body { --build-version: "${version}"; }`;
  const html = `<!doctype html><html><head><link rel="stylesheet" href="${stylePath}"></head><body><div id="root"></div><script type="module" src="${scriptPath}"></script></body></html>`;
  await mkdir(resolve(webRoot, "assets"), { recursive: true });
  await writeFile(resolve(webRoot, scriptPath.slice(1)), script);
  await writeFile(resolve(webRoot, stylePath.slice(1)), style);
  await writeFile(resolve(webRoot, "index.html"), html);
  return { scriptPath, stylePath, script, style, html };
}

async function fixture(serveWeb = true) {
  const directory = await mkdtemp(resolve(tmpdir(), "p6-static-"));
  directories.push(directory);
  const webRoot = resolve(directory, "web");
  const initial = await buildFixture(webRoot, "initial");
  const config: Config = {
    host: "127.0.0.1",
    port: 17006,
    baseUrl: "http://localhost:17006",
    issuer: "http://localhost:18006",
    apiResource: "http://localhost:17006/api",
    clientId: "p6-field-inspection",
    clientSecret: "s".repeat(43),
    dataDirectory: resolve(directory, "data"),
  };
  const database = new AppDatabase(":memory:", config.issuer);
  databases.push(database);
  const app = await createApp({
    config,
    database,
    authorization: fakeAuthorization(),
    oidc: {
      authorizationUrl: async () => new URL(`${config.issuer}/auth`),
      exchange: async () => ({
        subject: "elena",
        expiresAt: Date.now() + 60_000,
      }),
    },
    serveWeb,
    webRoot,
  });
  applications.push(app);
  await app.ready();
  return { app, config, database, directory, webRoot, initial };
}

afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

it("serves new hashed assets after repeated rebuilds without restarting", async () => {
  const { app, webRoot, initial } = await fixture();
  expect((await app.inject("/")).body).toBe(initial.html);
  expect((await app.inject(initial.scriptPath)).statusCode).toBe(200);

  for (const version of ["rebuild-one", "rebuild-two"]) {
    const next = await buildFixture(webRoot, version);
    const page = await app.inject("/");
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toBe(next.html);

    const script = await app.inject(next.scriptPath);
    expect(script.statusCode).toBe(200);
    expect(script.headers["content-type"]).toMatch(/javascript/u);
    expect(script.headers["x-content-type-options"]).toBe("nosniff");
    expect(script.body).toBe(next.script);

    const style = await app.inject(next.stylePath);
    expect(style.statusCode).toBe(200);
    expect(style.headers["content-type"]).toContain("text/css");
    expect(style.body).toBe(next.style);

    const head = await app.inject({ method: "HEAD", url: next.scriptPath });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    // The development watcher preserves the previous build's assets.
    expect((await app.inject(initial.scriptPath)).body).toBe(initial.script);
  }
});

it("keeps missing assets and routes as JSON 404s and files inside the static root", async () => {
  const { app, directory, webRoot } = await fixture();
  const sentinel = "private fixture outside the web root";
  await writeFile(resolve(directory, "private.txt"), sentinel);
  await writeFile(resolve(webRoot, ".env"), sentinel);
  await mkdir(resolve(webRoot, ".hidden"));
  await writeFile(resolve(webRoot, ".hidden/private.txt"), sentinel);

  for (const url of [
    "/assets/missing.js",
    "/assets/missing.css",
    "/api/unknown",
    "/auth/unknown",
    "/unknown",
  ]) {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      error: "not_found",
      requestId: expect.any(String),
    });
  }
  for (const url of [
    "/private.txt",
    "/../private.txt",
    "/%2e%2e/private.txt",
    "/assets/%2e%2e/%2e%2e/private.txt",
    "/.env",
    "/.hidden/private.txt",
  ]) {
    const response = await app.inject(url);
    expect([403, 404], url).toContain(response.statusCode);
    expect(response.body).not.toContain(sentinel);
  }
});

it("keeps authentication and CSRF checks ahead of static routing", async () => {
  const { app, config, database } = await fixture();
  const anonymous = await app.inject("/api/work-orders");
  expect(anonymous.statusCode).toBe(401);
  expect(anonymous.json().error).toBe("authentication_required");
  expect(anonymous.headers["cache-control"]).toBe("private, no-store");

  const session = database.createSession("user-elena", Date.now() + 60_000);
  const headers = {
    cookie: `p6_session=${session.id}`,
    origin: config.baseUrl,
  };
  const authenticated = await app.inject({ url: "/api/session", headers });
  expect(authenticated.statusCode).toBe(200);
  expect(authenticated.json().user.id).toBe("user-elena");
  for (const url of ["/api/work-orders", "/auth/logout"]) {
    const response = await app.inject({ method: "POST", url, headers });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("invalid_csrf");
    expect(response.headers["x-authorization-decision"]).toBeUndefined();
  }
});

it("still supports disabling static serving", async () => {
  const { app, initial } = await fixture(false);
  expect((await app.inject("/")).statusCode).toBe(404);
  expect((await app.inject(initial.scriptPath)).statusCode).toBe(404);
  expect((await app.inject("/healthz")).statusCode).toBe(200);
});
