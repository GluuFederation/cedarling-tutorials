import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { hash } from "../src/server/auth.ts";
import { fakeAuthorize, unavailable } from "../src/server/authorization.ts";
import { loadConfig } from "../src/server/config.ts";
import { Database } from "../src/server/database.ts";
import { denied } from "../src/server/errors.ts";

const dbs: Database[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
  for (const db of dbs.splice(0)) db.close();
});
async function start(
  mode: "permissive" | "unavailable" = "permissive",
  contactDenied = false,
) {
  const db = new Database(":memory:");
  dbs.push(db);
  const config = loadConfig({
    P12_CLIENT_SECRET: "a".repeat(40),
  });
  const raw = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  db.sql
    .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
    .run(hash(raw), "lin", csrf, Date.now() + 60000);
  const oidc = {
    async authorizationUrl() {
      return new URL("http://idp.localhost:4000/auth");
    },
    async exchange() {
      return { subject: "lin", expiresAt: Date.now() + 60000 };
    },
  };
  const app = contactDenied
    ? createApp(config, db, oidc, async (input) => {
        if (input.capability === "employee.contact.view") throw denied();
        await fakeAuthorize(input);
      })
    : createApp(
        config,
        db,
        oidc,
        mode === "unavailable" ? unavailable : fakeAuthorize,
      );
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP listener");
  return {
    db,
    base: `http://127.0.0.1:${address.port}`,
    headers: {
      Cookie: `p12_session=${raw}`,
      Origin: config.baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    },
  };
}
describe("native HTTP safeguards", () => {
  it("admits the three sign-in choices without treating employee fixtures as identities", async () => {
    const { base } = await start();
    for (const actor of ["lin", "nia", "ben"])
      expect(
        (
          await fetch(`${base}/auth/login?login_hint=${actor}`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(302);
    for (const actor of ["cora", "foreign-manager"])
      expect(
        (
          await fetch(`${base}/auth/login?login_hint=${actor}`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(400);
  });
  it("requires sessions and CSRF, bounds grammar and keeps route-owned intent", async () => {
    const { base, headers } = await start();
    expect((await fetch(`${base}/api/employees`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/grants`, {
          method: "POST",
          headers: { ...headers, Origin: "http://foreign.test" },
          body: JSON.stringify({
            employeeId: "cora",
            days: 1,
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/grants`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            employeeId: "cora",
            days: 1,
            intent: "read",
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/api/grants`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            employeeId: "cora",
            days: 8,
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/api/grants`, {
          method: "POST",
          headers,
          body: JSON.stringify({ x: "x".repeat(17000) }),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await fetch(`${base}/api/grants`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    const valid = await fetch(`${base}/api/grants`, {
      method: "POST",
      headers,
      body: JSON.stringify({ employeeId: "cora", days: 1 }),
    });
    expect(valid.status).toBe(201);
  });
  it("keeps denial response bytes private and permissive cookies server-only", async () => {
    const { base, headers } = await start("permissive", true);
    const contact = await fetch(`${base}/api/employees/cora/contact`, {
      headers,
    });
    expect(contact.status).toBe(403);
    expect(await contact.text()).not.toMatch(
      /cora@example|workPhone|workEmail/,
    );
    const profile = await fetch(`${base}/api/employees/cora/profile`, {
      headers,
    });
    expect(profile.status).toBe(200);
    expect(await profile.text()).not.toMatch(/workPhone|workEmail/);
    const session = await fetch(`${base}/api/session`, { headers });
    expect(await session.text()).not.toMatch(
      /access_token|id_token|clientSecret/,
    );
    const login = await fetch(`${base}/auth/login?login_hint=lin`, {
      redirect: "manual",
    });
    expect(login.status).toBe(302);
    expect(login.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(login.headers.get("set-cookie")).toMatch(/SameSite=Lax/);
    const callback = await fetch(`${base}/auth/callback?code=wrong`, {
      redirect: "manual",
    });
    expect(callback.status).toBe(400);
  });
  it("unavailable cannot create a grant even with a valid session", async () => {
    const { base, headers, db } = await start("unavailable");
    expect(
      (
        await fetch(`${base}/api/grants`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            employeeId: "cora",
            days: 1,
          }),
        })
      ).status,
    ).toBe(503);
    expect(db.sql.prepare("SELECT id FROM grants").all()).toHaveLength(0);
  });
});
