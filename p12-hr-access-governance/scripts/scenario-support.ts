import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { type Config, loadConfig } from "../src/server/config.ts";
import { assertDirectoryPath } from "../src/server/files.ts";
import type { Grant, Result } from "../src/shared/contracts.ts";
import { openScenarioSession } from "./scenario-session.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a TCP port");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}
export async function scenarioEnvironment(tutorialHostnames = false) {
  const appPort = await freePort();
  let idpPort = await freePort();
  while (idpPort === appPort) idpPort = await freePort();
  assertDirectoryPath(resolve(".local"));
  mkdirSync(resolve(".local"), { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(resolve(".local/scenario-"));
  const baseUrl = `http://${tutorialHostnames ? "p12.localhost" : "127.0.0.1"}:${appPort}`;
  const issuer = `http://${tutorialHostnames ? "idp.localhost" : "127.0.0.1"}:${idpPort}`;
  const shared = parseEnv(
    readFileSync(resolve("../shared/identity-provider/.env"), "utf8"),
  );
  const env = {
    ...process.env,
    ...shared,
    IDP_PROFILE: "default",
    IDP_HOST: "127.0.0.1",
    IDP_PORT: String(idpPort),
    IDP_ISSUER: issuer,
    P12_IDP_PORT: String(idpPort),
    P12_HOST: "127.0.0.1",
    P12_PORT: String(appPort),
    P12_BASE_URL: baseUrl,
    P12_ISSUER: issuer,
    P12_API_RESOURCE: `${baseUrl}/api`,
    P12_CLIENT_ID: `p12-scenario-${process.pid}`,
    P12_CLIENT_SECRET: randomBytes(32).toString("hex"),
    P12_REDIRECT_URI: `${baseUrl}/auth/callback`,
    P12_POST_LOGOUT_REDIRECT_URI: baseUrl,
    P12_DATA_DIR: resolve(directory, "data"),
    P12_DATA_HOST_DIR: resolve(directory, "data"),
  };
  mkdirSync(env.P12_DATA_DIR, { mode: 0o700 });
  return {
    env,
    directory,
    config: loadConfig(env),
    cleanup() {
      assert(directory.startsWith(resolve(".local/scenario-")));
      rmSync(directory, { recursive: true });
    },
  };
}
export async function waitFor(
  url: string,
  alive: () => boolean = () => true,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (!alive()) throw new Error("Owned service exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {
      /* Bounded startup retry. */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Service did not become ready: ${new URL(url).origin}`);
}
export async function proveAuthorizationFlow(config: Config): Promise<string> {
  const lin = await openScenarioSession(config, "lin");
  const nia = await openScenarioSession(config, "nia");
  const ben = await openScenarioSession(config, "ben");
  const call = async (session: typeof lin, path: string, body?: unknown) => {
    const response = await session.request(
      path,
      body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
    );
    assert(response.ok, `Expected success at ${path}, got ${response.status}`);
    return response.json();
  };
  assert.equal(
    (await call(ben, "/api/employees/cora/contact")).data.workEmail,
    "cora@example.test",
  );
  console.info("✓ selected gap: contact disclosure without an effective grant");
  const created = (await call(lin, "/api/grants", {
    employeeId: "cora",
    days: 1,
  })) as Result<Grant>;
  const approved = (await call(lin, `/api/grants/${created.data.id}/approve`, {
    version: created.data.version,
  })) as Result<Grant>;
  assert.equal(approved.data.status, "approved");
  console.info("✓ selected gap: reviewer Lin approves her own request");
  const stale = await lin.request(`/api/grants/${created.data.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(stale.status, 409);
  const revoked = (await call(nia, `/api/grants/${created.data.id}/revoke`, {
    version: approved.data.version,
  })) as Result<Grant>;
  assert.equal(revoked.data.status, "revoked");
  assert.equal(
    (await call(ben, "/api/employees/cora/contact")).data.workEmail,
    "cora@example.test",
  );
  console.info("✓ selected gap: contact disclosure after revocation");
  const terminal = (await call(
    lin,
    `/api/grants/${created.data.id}`,
  )) as Result<Grant>;
  assert.equal(terminal.data.status, "revoked");
  const next = (await call(lin, "/api/grants", {
    employeeId: "cora",
    days: 1,
  })) as Result<Grant>;
  const separate = (await call(nia, `/api/grants/${next.data.id}/approve`, {
    version: next.data.version,
  })) as Result<Grant>;
  assert.equal(separate.data.status, "approved");
  assert.equal(
    (await ben.request("/api/employees/foreign/contact")).status,
    404,
  );
  assert.equal((await fetch(`${config.baseUrl}/api/employees`)).status, 401);
  const forgery = await lin.request(`/api/grants/${next.data.id}/revoke`, {
    method: "POST",
    body: JSON.stringify({ version: 2, intent: "read" }),
  });
  assert.equal(forgery.status, 400);
  console.info(
    "✓ separate approval, terminal metadata, fresh requests, stale-version and native-boundary controls",
  );
  return next.data.id;
}
export async function provePersistence(config: Config, id: string) {
  const session = await openScenarioSession(config, "nia");
  const response = await session.request(`/api/grants/${id}`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Result<Grant>;
  assert.equal(body.data.status, "approved");
  assert.equal(body.data.version, 2);
  console.info("✓ approved grant survives application restart");
}
