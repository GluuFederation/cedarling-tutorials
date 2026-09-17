import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import type { AuthorizationPort } from "../src/server/authorization.ts";
import { SchedulingService } from "../src/server/service.ts";
import { testDatabase } from "./support.ts";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

async function fixture() {
  const opened = testDatabase();
  cleanup = opened.cleanup;
  const user = opened.database.findUser("dina");
  if (!user) throw new Error("missing user");
  const created = opened.database.createSession(
    user.id,
    "signed-token",
    Date.now() + 60_000,
  );
  const authorization: AuthorizationPort = {
    async authorize() {
      return true;
    },
  };
  const app = await createApp({
    config: opened.config,
    database: opened.database,
    oidc: {
      async authorizationUrl() {
        return new URL("http://idp.localhost:4000/auth");
      },
      async exchange() {
        return {
          subject: "dina",
          accessToken: "signed-token",
          expiresAt: Date.now() + 60_000,
        };
      },
    },
    service: new SchedulingService(opened.database, authorization),
    serveWeb: false,
  });
  return { app, cookie: `p14_session=${created.id}`, csrf: created.csrfToken };
}

describe("HTTP boundary", () => {
  it("returns bounded health and unauthenticated session states", async () => {
    const { app } = await fixture();
    await expect(
      app
        .inject({ method: "GET", url: "/healthz" })
        .then((reply) => reply.json()),
    ).resolves.toEqual({
      status: "ok",
      service: "p14-ai-scheduling-assistant",
    });
    await expect(
      app
        .inject({ method: "GET", url: "/api/session" })
        .then((reply) => reply.json()),
    ).resolves.toEqual({ authenticated: false });
    await app.close();
  });

  it("requires request integrity before proposal creation", async () => {
    const { app, cookie } = await fixture();
    const reply = await app.inject({
      method: "POST",
      url: "/api/assistant/proposals",
      headers: { cookie },
      payload: { requestId: "list-meetings" },
    });
    expect(reply.statusCode).toBe(403);
    expect(reply.json()).toMatchObject({ error: "REQUEST_INTEGRITY_REQUIRED" });
    await app.close();
  });

  it("creates a server-owned proposal with valid session evidence", async () => {
    const { app, cookie, csrf } = await fixture();
    const reply = await app.inject({
      method: "POST",
      url: "/api/assistant/proposals",
      headers: {
        cookie,
        origin: "http://p14.localhost:3014",
        "x-csrf-token": csrf,
      },
      payload: { requestId: "list-meetings" },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({
      proposal: {
        tool: "list_meetings",
        action: "Refresh my meetings",
        version: 1,
      },
    });
    await app.close();
  });
});
