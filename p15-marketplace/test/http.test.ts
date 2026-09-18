import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.ts";
import { loadConfig } from "../src/server/config.ts";
import { Store } from "../src/server/database.ts";
import { encrypt, hashToken, randomToken } from "../src/server/security.ts";
import type { AuthorizationAdapter } from "../src/server/service.ts";

let store: Store;
let server: Server;
let base: string;
let csrf: string;
let raw: string;
const key = randomBytes(32);
const origin = "http://p15.localhost:3015";
const allow: AuthorizationAdapter = () => ({
  decision: "ALLOW",
  mode: "permissive",
});

beforeEach(async () => {
  store = new Store(":memory:");
  raw = randomToken();
  csrf = randomToken();
  store.createSession(
    {
      hash: hashToken(raw),
      actorId: "bao",
      csrf,
      encryptedTokens: encrypt("private-token-evidence", key),
      expiresAt: Date.now() + 100_000,
    },
    Date.now(),
  );
  const config = loadConfig({ P15_CLIENT_SECRET: randomToken() });
  server = createApp(
    config,
    store,
    key,
    { authorization: vi.fn(), exchange: vi.fn() },
    allow,
    vi.fn(),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
  store.close();
});
function request(
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return fetch(`${base}${path}`, {
    headers: {
      cookie: `p15_session=${raw}`,
      "content-type": "application/json",
      origin,
      "x-csrf-token": csrf,
      ...extra,
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
}

it("authenticates an opaque session without releasing OAuth evidence", async () => {
  expect((await fetch(`${base}/api/session`)).status).toBe(401);
  const response = await request("/api/session");
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain("private-token");
  expect(JSON.parse(text).user).toMatchObject({ id: "bao", role: "buyer" });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
});

it("enforces Origin, CSRF, Fetch Metadata, JSON, and body limits", async () => {
  const body = { reasonCategory: "damaged", expectedVersion: 0 };
  for (const headers of [
    { origin: "http://evil.test" },
    { "x-csrf-token": "fake" },
    { "sec-fetch-site": "cross-site" },
  ])
    expect(
      (await request("/api/refunds/refund-bao-001/request", body, headers))
        .status,
    ).toBe(403);
  expect(
    (
      await request("/api/refunds/refund-bao-001/request", body, {
        "content-type": "text/plain",
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await request("/api/refunds/refund-bao-001/request", {
        ...body,
        reason: "x".repeat(17_000),
      })
    ).status,
  ).toBe(413);
  expect(store.refund("refund-bao-001")).toMatchObject({
    state: "eligible",
    version: 0,
  });
});

it("uses bounded non-enumerating read failures and exact projection intent", async () => {
  const missing = await request("/api/refunds/missing?section=buyer");
  expect(missing.status).toBe(404);
  const invalid = await request("/api/refunds/refund-bao-001?section=admin");
  expect(invalid.status).toBe(400);
  const seller = await request("/api/refunds/refund-bao-001?section=seller");
  const body = await seller.json();
  expect(body.refund).not.toHaveProperty("reason");
  expect(body.refund).not.toHaveProperty("riskCode");
  expect(body.refund).toMatchObject({
    view: "seller",
    expectedSeller: "Sela Books",
  });
});

it("serves the fixed catalog, shared queues, and simulated checkout", async () => {
  const catalog = await request("/api/catalog");
  expect(catalog.status).toBe(200);
  const books = (await catalog.json()).books;
  expect(books).toHaveLength(5);
  const order = await request("/api/orders", {
    bookId: "book-oauth-action",
    expectedVersion: 1,
  });
  expect(order.status).toBe(200);
  expect((await order.json()).order).toMatchObject({
    buyerId: "bao",
    amountMinor: 4_999,
    refund: { state: "eligible" },
  });
  expect((await (await request("/api/orders")).json()).orders).toHaveLength(10);
  expect((await (await request("/api/refunds")).json()).refunds).toHaveLength(
    10,
  );
});

it("rejects forged money and direct transitions with sanitized failures", async () => {
  const forged = await request("/api/refunds/refund-bao-001/request", {
    reasonCategory: "damaged",
    amountMinor: 1,
    expectedVersion: 0,
  });
  expect(forged.status).toBe(400);
  expect(await forged.json()).toEqual({
    error: { code: "INVALID_INPUT" },
    requestId: expect.any(String),
  });
  const direct = await request("/api/refunds/refund-bao-001/approval", {
    expectedVersion: 0,
  });
  expect(direct.status).toBe(409);
  expect(await direct.text()).not.toContain("eligible");
});

it("returns no false success or mutation when authorization is unavailable", async () => {
  await new Promise<void>((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
  const config = loadConfig({ P15_CLIENT_SECRET: randomToken() });
  server = createApp(
    config,
    store,
    key,
    { authorization: vi.fn(), exchange: vi.fn() },
    () => {
      throw new Error("secret dependency details");
    },
    vi.fn(),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}`;
  const response = await request("/api/refunds/refund-bao-001/request", {
    reasonCategory: "damaged",
    expectedVersion: 0,
  });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret dependency");
  expect(store.refund("refund-bao-001")?.state).toBe("eligible");
});

it("expires, tampers, and logs out sessions without affecting another session", async () => {
  const otherRaw = randomToken();
  const current = store.session(hashToken(raw), Date.now());
  if (!current) throw new Error("Missing test session");
  store.createSession({ ...current, hash: hashToken(otherRaw) }, Date.now());
  const logout = await request("/auth/logout", {});
  expect(logout.status).toBe(204);
  expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(store.session(hashToken(raw), Date.now())).toBeUndefined();
  expect(store.session(hashToken(otherRaw), Date.now())).toBeDefined();
  store.db
    .prepare("UPDATE sessions SET encryptedTokens='bad' WHERE hash=?")
    .run(hashToken(otherRaw));
  const tampered = await request("/api/session", undefined, {
    cookie: `p15_session=${otherRaw}`,
  });
  expect(tampered.status).toBe(401);
  expect(store.session(hashToken(otherRaw), Date.now())).toBeUndefined();
});

it("turns database failures into bounded errors and rolls back state", async () => {
  store.db.exec(`
    CREATE TRIGGER fail_refund BEFORE UPDATE ON refunds
    BEGIN SELECT RAISE(ABORT, 'secret database path'); END;
  `);
  const response = await request("/api/refunds/refund-bao-001/request", {
    reasonCategory: "damaged",
    reason: "confidential buyer detail",
    expectedVersion: 0,
  });
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(text).not.toContain("secret database");
  expect(text).not.toContain("confidential");
  expect(store.refund("refund-bao-001")?.state).toBe("eligible");
});
