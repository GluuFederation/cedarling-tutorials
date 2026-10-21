import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import type { AuthorizationPort } from "../src/server/authorization.ts";
import type { Config } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import { capabilities } from "../src/shared/capabilities.ts";

const directories: string[] = [];
const databases: AppDatabase[] = [];
const applications: FastifyInstance[] = [];
const config: Config = {
  host: "127.0.0.1",
  port: 17007,
  baseUrl: "http://localhost:17007",
  issuer: "http://localhost:18007",
  apiResource: "http://localhost:17007/api",
  clientId: "p7-collaborative-docs",
  clientSecret: "s".repeat(43),
  dataDirectory: resolve(".local/test-data"),
};
const oidc: OidcRuntime = {
  authorizationUrl: async () => new URL("http://localhost:18007/auth"),
  exchange: async () => ({ subject: "noah", expiresAt: Date.now() + 60_000 }),
};

function allowAll(): AuthorizationPort {
  return {
    async authorize() {
      return true;
    },
    async authorizeMany(requests) {
      const decisions: Record<string, boolean> = {};
      for (const request of requests) decisions[request.capability] = true;
      return decisions;
    },
  };
}

async function fixture(
  userId: string,
  authorization: AuthorizationPort = allowAll(),
) {
  const directory = mkdtempSync(resolve(tmpdir(), "p7-app-"));
  directories.push(directory);
  const database = new AppDatabase(
    resolve(directory, "test.sqlite"),
    config.issuer,
  );
  databases.push(database);
  const created = database.createSession(userId, Date.now() + 60_000);
  const app = await createApp({
    config,
    database,
    oidc,
    authorization,
    serveWeb: false,
  });
  applications.push(app);
  return {
    app,
    database,
    sessionId: created.id,
    headers: {
      cookie: `p7_session=${created.id}`,
      origin: config.baseUrl,
      "x-csrf-token": created.session.csrfToken,
    },
  };
}

afterEach(async () => {
  for (const app of applications.splice(0)) await app.close();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P7 HTTP boundary", () => {
  it.each([
    {
      method: "PATCH",
      path: "",
      body: {
        title: "Revoked edit",
        content: "Must not be saved",
        expectedDocumentVersion: 1,
      },
    },
    {
      method: "POST",
      path: "/comments",
      body: {
        body: "Must not be posted",
        idempotencyKey: crypto.randomUUID(),
      },
    },
    {
      method: "PUT",
      path: "/access/user-lena",
      body: { role: "editor", expectedAccessVersion: 1 },
    },
    {
      method: "DELETE",
      path: "/access/user-lena",
      body: { expectedAccessVersion: 1 },
    },
  ] as const)(
    "does not commit $method $path after session revocation",
    async ({ method, path, body }) => {
      const authorization = allowAll();
      const { app, database, headers, sessionId } = await fixture(
        "user-maya",
        authorization,
      );
      const before = database.findDocument("doc-launch-brief", "user-maya");
      const relations = database.documentRelations("doc-launch-brief");
      authorization.authorize = async () => {
        database.destroySession(sessionId);
        return true;
      };
      const response = await app.inject({
        method,
        url: `/api/documents/doc-launch-brief${path}`,
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(401);
      expect(database.findDocument("doc-launch-brief", "user-maya")).toEqual(
        before,
      );
      expect(database.documentRelations("doc-launch-brief")).toEqual(relations);
    },
  );

  it("rechecks a stream session after its delivery decision", async () => {
    const authorization = allowAll();
    const { app, database, headers } = await fixture(
      "user-maya",
      authorization,
    );
    const reader = database.createSession("user-noah", Date.now() + 60_000);
    authorization.authorize = async (request) => {
      if (request.requestId.includes(":")) database.destroySession(reader.id);
      return true;
    };
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/documents/doc-launch-brief/events`,
      { headers: { cookie: `p7_session=${reader.id}` } },
    );
    const update = await app.inject({
      method: "PATCH",
      url: "/api/documents/doc-launch-brief",
      headers,
      payload: {
        title: "Launch brief",
        content: "Updated",
        expectedDocumentVersion: 1,
      },
    });
    expect(update.statusCode).toBe(200);
    const events = await response.text();
    expect(events).toContain("event: ready");
    expect(events).not.toContain("document.updated");
  });

  it.each(["create", "read", "list", "stream"])(
    "rejects a session revoked during %s authorization",
    async (operation) => {
      const authorization = allowAll();
      const { app, database, headers, sessionId } = await fixture(
        "user-noah",
        authorization,
      );
      const revoke = () => database.destroySession(sessionId);
      authorization.authorize = async () => {
        revoke();
        return true;
      };
      authorization.authorizeMany = async (requests) => {
        revoke();
        return Object.fromEntries(
          requests.map((request) => [request.capability, true]),
        );
      };
      const before = database.listDocuments("user-noah").length;
      const response = await app.inject({
        method: operation === "create" ? "POST" : "GET",
        url:
          operation === "create" || operation === "list"
            ? "/api/documents"
            : `/api/documents/doc-launch-brief${operation === "stream" ? "/events" : ""}`,
        headers,
        ...(operation === "create"
          ? { payload: { title: "Revoked", content: "Must not be saved" } }
          : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(database.listDocuments("user-noah")).toHaveLength(before);
    },
  );

  it("closes an open event stream when the server stops", async () => {
    const { app, headers } = await fixture("user-noah");
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/documents/doc-launch-brief/events`,
      {
        headers: { cookie: headers.cookie },
        signal: controller.signal,
      },
    );
    try {
      expect(response.status).toBe(200);
      const closing = app.close().then(() => "closed");
      expect(
        await Promise.race([
          closing,
          new Promise((resolve) => setTimeout(() => resolve("stalled"), 750)),
        ]),
      ).toBe("closed");
    } finally {
      controller.abort();
    }
  });

  it("reproduces Noah reading a private document", async () => {
    const { app, headers } = await fixture("user-noah");
    const response = await app.inject({
      method: "GET",
      url: "/api/documents/doc-private-planning",
      headers: { cookie: headers.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "doc-private-planning",
      role: null,
      content: expect.stringContaining("Private staffing"),
      actions: { edit: true, comment: true, manageAccess: true },
    });
    expect(response.json()).not.toHaveProperty("allowed");
  });

  it("reproduces commenter editing and editor managing access", async () => {
    const lena = await fixture("user-lena");
    const edited = await lena.app.inject({
      method: "PATCH",
      url: "/api/documents/doc-launch-brief",
      headers: lena.headers,
      payload: {
        title: "Launch brief",
        content: "Lena changed the document.",
        expectedDocumentVersion: 1,
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ documentVersion: 2 });

    const noah = await fixture("user-noah");
    const access = await noah.app.inject({
      method: "DELETE",
      url: "/api/documents/doc-launch-brief/access/user-lena",
      headers: noah.headers,
      payload: { expectedAccessVersion: 1 },
    });
    expect(access.statusCode).toBe(200);
    expect(access.json().members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-lena" }),
      ]),
    );
  });

  it("keeps origin and CSRF checks outside authorization", async () => {
    const { app, headers, database } = await fixture("user-lena");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/documents/doc-launch-brief",
      headers: { cookie: headers.cookie },
      payload: {
        title: "Launch brief",
        content: "No trusted mutation evidence.",
        expectedDocumentVersion: 1,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(
      database.findDocument("doc-launch-brief", "user-lena"),
    ).toMatchObject({
      documentVersion: 1,
    });
  });

  it("does not mutate on denial or disclose access candidates", async () => {
    const authorization: AuthorizationPort = {
      async authorize(request) {
        return request.capability !== capabilities.edit;
      },
      async authorizeMany(requests) {
        const decisions: Record<string, boolean> = {};
        for (const request of requests) {
          decisions[request.capability] =
            request.capability !== capabilities.manageAccess;
        }
        return decisions;
      },
    };
    const { app, headers, database } = await fixture(
      "user-lena",
      authorization,
    );

    const denied = await app.inject({
      method: "PATCH",
      url: "/api/documents/doc-launch-brief",
      headers,
      payload: {
        title: "Launch brief",
        content: "This must not be stored.",
        expectedDocumentVersion: 1,
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(
      database.findDocument("doc-launch-brief", "user-lena"),
    ).toMatchObject({ documentVersion: 1 });

    const detail = await app.inject({
      method: "GET",
      url: "/api/documents/doc-launch-brief",
      headers: { cookie: headers.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().candidates).toEqual([]);
    expect(detail.json().actions).toEqual({
      edit: true,
      comment: true,
      manageAccess: false,
    });
  });

  it("does not reveal a document when read authorization is denied", async () => {
    const authorization: AuthorizationPort = {
      async authorize() {
        return true;
      },
      async authorizeMany(requests) {
        const decisions: Record<string, boolean> = {};
        for (const request of requests) {
          decisions[request.capability] =
            request.capability !== capabilities.read;
        }
        return decisions;
      },
    };
    const { app, headers } = await fixture("user-noah", authorization);
    const response = await app.inject({
      method: "GET",
      url: "/api/documents/doc-private-planning",
      headers: { cookie: headers.cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });
});
