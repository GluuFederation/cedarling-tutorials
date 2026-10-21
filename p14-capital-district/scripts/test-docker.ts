import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type {
  CommandResult,
  GameCommand,
  MatchSnapshot,
} from "../src/shared/contracts.ts";
import { openSession } from "./scenario-session.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

const appPort = await freePort();
let idpPort = await freePort();
while (idpPort === appPort) idpPort = await freePort();
const baseUrl = `http://localhost:${appPort}`;
const issuer = `http://localhost:${idpPort}`;
const project = `p14-check-${process.pid}-${randomBytes(4).toString("hex")}`;
const env = {
  ...process.env,
  P14_PORT: String(appPort),
  P14_IDP_PORT: String(idpPort),
  P14_BASE_URL: baseUrl,
  P14_ISSUER: issuer,
  P14_CLIENT_SECRET: randomBytes(32).toString("hex"),
};

async function compose(args: string[]) {
  await new Promise<void>((done, reject) => {
    const child = spawn("docker", ["compose", "-p", project, ...args], {
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(new Error(`P14 Docker command failed (exit ${code})`)),
    );
  });
}

async function waitReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // A restarted container may not have bound its listener yet.
    }
    await delay(250);
  }
  throw new Error("P14 did not become ready after restart");
}

let started = false;
try {
  started = true;
  await compose(["up", "--build", "--wait", "--wait-timeout", "90"]);
  const dina = await openSession({ baseUrl, issuer }, "dina");
  const amara = await openSession({ baseUrl, issuer }, "amara");
  const created = await dina.request("/api/matches", {
    method: "POST",
    headers: { "idempotency-key": randomUUID() },
    body: JSON.stringify({ name: "Docker practice", preset: "practice" }),
  });
  assert.equal(created.status, 200);
  let match = ((await created.json()) as CommandResult).match;
  async function command(
    client: typeof dina,
    input: Omit<GameCommand, "expectedVersion">,
  ) {
    const response = await client.request(`/api/matches/${match.id}/commands`, {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ ...input, expectedVersion: match.version }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    match = ((await response.json()) as CommandResult).match;
  }
  await command(amara, { type: "join", payload: {} });
  await command(dina, { type: "match.start", payload: {} });
  assert.ok(match.activeSeatId);
  await command(dina, {
    type: "property.build",
    payload: { seatId: match.activeSeatId, propertyId: "space-6" },
  });
  assert.equal(
    match.properties.find((property) => property.id === "space-6")?.level,
    1,
  );
  assert.equal(match.players[0]?.cash, 940);
  const version = match.version;
  await compose(["restart", "capital-district"]);
  await waitReady();
  const persistent = await dina.request(`/api/matches/${match.id}`);
  assert.equal(persistent.status, 200);
  assert.equal(((await persistent.json()) as MatchSnapshot).version, version);
  await compose(["stop", "capital-district"]);
  await compose([
    "run",
    "--rm",
    "--no-deps",
    "capital-district",
    "node",
    "--env-file=/run/config/app.env",
    "dist/server/data/reset.js",
  ]);
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
  const fresh = await openSession({ baseUrl, issuer }, "dina");
  const matches = await fresh.request("/api/matches");
  assert.deepEqual(await matches.json(), []);
  console.info(
    "P14 Docker checks passed: real sign-in, two players, practice gap, persisted match and explicit reset.",
  );
} finally {
  if (started) await compose(["down", "--volumes", "--remove-orphans"]);
}
