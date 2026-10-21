import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { AuthStore } from "../src/server/auth/auth-store.ts";
import type { OidcRuntime } from "../src/server/auth/oidc.ts";
import { loadConfig } from "../src/server/config/environment.ts";
import { GameStore } from "../src/server/data/game-store.ts";
import { GameService } from "../src/server/game/service.ts";

const config = loadConfig({
  P14_CLIENT_SECRET: "s".repeat(32),
  P14_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(options: { clock?: () => number; deny?: boolean } = {}) {
  const auth = new AuthStore(":memory:", config, options.clock);
  const store = new GameStore(":memory:");
  const service = new GameService(store, {
    dice: () => [1, 1],
    ...(options.deny
      ? { authorize: { decide: async () => ({ decision: false }) } }
      : {}),
  });
  let exchangeCount = 0;
  const oidc: OidcRuntime = {
    authorizationUrl: async (transaction, hint) =>
      new URL(
        `http://localhost:18014/auth?state=${transaction.state}&hint=${hint}`,
      ),
    exchange: async () => {
      exchangeCount++;
      return {
        subject: "dina",
        accessToken: "private-token",
        expiresAt: Date.now() + 60_000,
      };
    },
  };
  const app = await createApp({ config, auth, oidc, service, serveWeb: false });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    auth.close();
    store.close();
  });
  const signIn = (id = "dina", expiresAt = Date.now() + 60_000) => {
    const session = auth.createSession(id, "private-access-token", expiresAt);
    return {
      cookie: `p14_session=${session.id}`,
      origin: config.baseUrl,
      "x-csrf-token": session.csrfToken,
    };
  };
  return { app, auth, store, service, signIn, exchanges: () => exchangeCount };
}
const createMatch = async (
  app: FastifyInstance,
  headers: ReturnType<Awaited<ReturnType<typeof fixture>>["signIn"]>,
  key = "create-key-1",
) =>
  app.inject({
    method: "POST",
    url: "/api/matches",
    headers: { ...headers, "idempotency-key": key },
    payload: { name: "Practice", preset: "practice" },
  });

describe("HTTP authentication and integrity", () => {
  it("returns a public session view without credentials", async () => {
    const f = await fixture();
    expect((await f.app.inject("/api/session")).json()).toEqual({ user: null });
    const headers = f.signIn();
    const result = await f.app.inject({ url: "/api/session", headers });
    expect(result.json()).toEqual({
      user: { id: "dina", name: "Dina" },
      csrfToken: headers["x-csrf-token"],
    });
    expect(result.body).not.toContain("private-access-token");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["x-request-id"]).toBeTruthy();
  });
  it("requires authentication for all match reads and writes", async () => {
    const f = await fixture();
    for (const url of [
      "/api/matches",
      "/api/matches/unknown",
      "/api/matches/unknown/events",
    ])
      expect((await f.app.inject(url)).statusCode).toBe(401);
    expect(
      (
        await createMatch(f.app, {
          cookie: "",
          origin: config.baseUrl,
          "x-csrf-token": "",
        })
      ).statusCode,
    ).toBe(401);
  });
  it.each(["origin", "x-csrf-token"])(
    "requires a matching %s on writes",
    async (name) => {
      const f = await fixture();
      const headers = { ...f.signIn(), [name]: "incorrect" };
      expect((await createMatch(f.app, headers)).statusCode).toBe(403);
      expect(f.service.list()).toHaveLength(0);
    },
  );
  it("rejects cross-site metadata, malformed Unicode CSRF and missing keys", async () => {
    const f = await fixture();
    const headers = f.signIn();
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/matches",
          headers: {
            ...headers,
            "sec-fetch-site": "cross-site",
            "idempotency-key": "valid-key-1",
          },
          payload: { name: "Test", preset: "normal" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await createMatch(f.app, { ...headers, "x-csrf-token": "é".repeat(43) }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/matches",
          headers,
          payload: { name: "Test", preset: "normal" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("bounds JSON bodies and rejects extra creation fields", async () => {
    const f = await fixture();
    const headers = { ...f.signIn(), "idempotency-key": "valid-key-1" };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/matches",
          headers,
          payload: { name: "x".repeat(9000), preset: "normal" },
        })
      ).statusCode,
    ).toBe(413);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/matches",
          headers,
          payload: { name: "Test", preset: "normal", actorId: "amara" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("uses a single-use login transaction and rotates an existing session", async () => {
    const f = await fixture();
    expect(
      (await f.app.inject("/auth/login?login_hint=unknown")).statusCode,
    ).toBe(400);
    const prior = f.signIn("amara");
    const start = await f.app.inject("/auth/login?login_hint=dina");
    const transaction = start.cookies.find(
      (cookie) => cookie.name === "p14_oidc",
    );
    expect(transaction?.httpOnly).toBe(true);
    const callbackCookie = `${prior.cookie}; p14_oidc=${transaction?.value}`;
    const callback = await f.app.inject({
      url: "/auth/callback?code=example",
      headers: { cookie: callbackCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(
      callback.cookies.find((cookie) => cookie.name === "p14_session")
        ?.httpOnly,
    ).toBe(true);
    expect(
      (await f.app.inject({ url: "/api/session", headers: prior })).json(),
    ).toEqual({ user: null });
    expect(
      (
        await f.app.inject({
          url: "/auth/callback?code=example",
          headers: { cookie: callbackCookie },
        })
      ).statusCode,
    ).toBe(400);
    expect(f.exchanges()).toBe(1);
  });
  it("logs out only with integrity checks and invalidates the old cookie", async () => {
    const f = await fixture();
    const headers = f.signIn();
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/auth/logout",
          headers: { cookie: headers.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await f.app.inject({ method: "POST", url: "/auth/logout", headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (await f.app.inject({ url: "/api/session", headers })).json(),
    ).toEqual({ user: null });
  });
  it("expires sessions using the authoritative store clock", async () => {
    let now = Date.now();
    const f = await fixture({ clock: () => now });
    const headers = f.signIn("dina", now + 1000);
    now += 1001;
    expect(
      (await f.app.inject({ url: "/api/matches", headers })).statusCode,
    ).toBe(401);
  });
});

describe("HTTP game boundaries and streams", () => {
  it.each([
    { name: "Match", key: "a".repeat(7), status: 400 },
    { name: "Match", key: "a".repeat(8), status: 200 },
    { name: "n".repeat(80), key: "b".repeat(100), status: 200 },
    { name: "Match", key: "b".repeat(101), status: 400 },
    { name: "Match", key: "invalid key", status: 400 },
    { name: "n".repeat(81), key: "long-name-key", status: 400 },
    { name: "   ", key: "blank-name-key", status: 400 },
    { name: `  ${"n".repeat(80)}  `, key: "trimmed-name-key", status: 200 },
  ])(
    "uses the same creation limits through HTTP and the game module: $status, $key",
    async ({ name, key, status }) => {
      const f = await fixture();
      const input = { name, preset: "normal" } as const;
      const response = await f.app.inject({
        method: "POST",
        url: "/api/matches",
        headers: { ...f.signIn(), "idempotency-key": key },
        payload: input,
      });
      expect(response.statusCode).toBe(status);
      const direct = f.service.create(
        { id: "amara", name: "Amara" },
        input,
        key,
      );
      if (status === 200) {
        expect(response.json().match.name).toBe(name.trim());
        await expect(direct).resolves.toMatchObject({
          match: { name: name.trim() },
        });
      } else await expect(direct).rejects.toMatchObject({ status: 400 });
    },
  );
  it("binds receipts to the session, shares public state and replays exactly once", async () => {
    const f = await fixture();
    const dina = f.signIn();
    const amara = f.signIn("amara");
    const created = await createMatch(f.app, dina);
    expect(created.statusCode).toBe(200);
    const { match, receipt } = created.json();
    expect(receipt.actorId).toBe("dina");
    const read = await f.app.inject({
      url: `/api/matches/${match.id}`,
      headers: amara,
    });
    expect(read.json()).toMatchObject({ id: match.id, hostId: "dina" });
    expect((await createMatch(f.app, dina)).json().receipt).toEqual(receipt);
    expect(f.service.list()).toHaveLength(1);
    const command = {
      type: "join",
      expectedVersion: match.version,
      payload: {},
    };
    const joined = await f.app.inject({
      method: "POST",
      url: `/api/matches/${match.id}/commands`,
      headers: { ...amara, "idempotency-key": "join-key-1" },
      payload: command,
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().receipt.actorId).toBe("amara");
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/matches/${match.id}/commands`,
          headers: { ...amara, "idempotency-key": "join-key-1" },
          payload: command,
        })
      ).json().receipt,
    ).toEqual(joined.json().receipt);
    expect(joined.json().match.players).toHaveLength(2);
  });
  it("does not mutate state after an injected authorization denial", async () => {
    const f = await fixture({ deny: true });
    const dina = f.signIn();
    const amara = f.signIn("amara");
    const { match } = (await createMatch(f.app, dina)).json();
    const joined = await f.app.inject({
      method: "POST",
      url: `/api/matches/${match.id}/commands`,
      headers: { ...amara, "idempotency-key": "join-key-1" },
      payload: { type: "join", expectedVersion: match.version, payload: {} },
    });
    const version = joined.json().match.version;
    const denied = await f.app.inject({
      method: "POST",
      url: `/api/matches/${match.id}/commands`,
      headers: { ...dina, "idempotency-key": "start-key-1" },
      payload: { type: "match.start", expectedVersion: version, payload: {} },
    });
    expect(denied.statusCode).toBe(403);
    expect(f.service.get(match.id).version).toBe(version);
  });
  it("sends an initial snapshot and closes a stream when its session logs out", async () => {
    const f = await fixture();
    const headers = f.signIn();
    const { match } = (await createMatch(f.app, headers)).json();
    const pending = f.app
      .inject({ url: `/api/matches/${match.id}/events`, headers })
      .then((response) => response);
    await delay(20);
    await f.app.inject({ method: "POST", url: "/auth/logout", headers });
    const streamed = await pending;
    expect(streamed.statusCode).toBe(200);
    expect(streamed.body).toContain("event: snapshot");
    expect(streamed.body).toContain(match.id);
    expect(streamed.body).not.toContain("private-access-token");
  });
  it("refuses cross-origin event streams and returns an honest health identity", async () => {
    const f = await fixture();
    const headers = f.signIn();
    const { match } = (await createMatch(f.app, headers)).json();
    expect(
      (
        await f.app.inject({
          url: `/api/matches/${match.id}/events`,
          headers: { ...headers, origin: "https://outside.test" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await f.app.inject("/healthz")).json()).toEqual({
      service: "p14-capital-district",
      status: "ok",
    });
  });
  it("closes a stream at the session deadline without waiting for a game change", async () => {
    const f = await fixture();
    const headers = f.signIn("dina", Date.now() + 120);
    const { match } = (await createMatch(f.app, headers)).json();
    const streamed = await f.app.inject({
      url: `/api/matches/${match.id}/events`,
      headers,
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.body).toContain("event: snapshot");
    expect(
      (await f.app.inject({ url: "/api/session", headers })).json(),
    ).toEqual({ user: null });
  });
  it("closes the previous account's stream when callback rotates the session", async () => {
    const f = await fixture();
    const prior = f.signIn("amara");
    const { match } = (await createMatch(f.app, prior)).json();
    const pending = f.app
      .inject({ url: `/api/matches/${match.id}/events`, headers: prior })
      .then((response) => response);
    await delay(20);
    const start = await f.app.inject("/auth/login?login_hint=dina");
    const transaction = start.cookies.find(
      (cookie) => cookie.name === "p14_oidc",
    );
    await f.app.inject({
      url: "/auth/callback?code=example",
      headers: { cookie: `${prior.cookie}; p14_oidc=${transaction?.value}` },
    });
    expect((await pending).body).toContain("event: snapshot");
    expect(
      (await f.app.inject({ url: "/api/session", headers: prior })).json(),
    ).toEqual({ user: null });
  });
});
