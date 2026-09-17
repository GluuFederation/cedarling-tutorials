import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { prepareData } from "../src/server/prepare-data.ts";
import { randomToken } from "../src/server/security.ts";
import type {
  ActorId,
  ProjectionIntent,
  RefundMutationResult,
  RefundViewResult,
  SessionView,
} from "../src/shared/protocol.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback port");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
export async function isolatedState() {
  const ports = new Set<number>();
  while (ports.size < 2) ports.add(await freePort());
  const [port, idpPort] = [...ports];
  assert(port && idpPort);
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(resolve(".local/scenario-"));
  prepareData(directory);
  const baseUrl = `http://127.0.0.1:${port}`;
  const issuer = `http://127.0.0.1:${idpPort}`;
  const shared = parseEnv(
    readFileSync(resolve("../shared/identity-provider/.env"), "utf8"),
  );
  const values = {
    P15_BASE_URL: baseUrl,
    P15_PORT: String(port),
    P15_HOST: "127.0.0.1",
    P15_ISSUER: issuer,
    P15_IDP_PORT: String(idpPort),
    P15_CLIENT_ID: "p15-marketplace",
    P15_CLIENT_SECRET: randomToken(),
    P15_API_RESOURCE: `${baseUrl}/api`,
    P15_REDIRECT_URI: `${baseUrl}/auth/callback`,
    P15_POST_LOGOUT_REDIRECT_URI: baseUrl,
    P15_DATA_DIR: directory,
    P15_DATA_HOST_DIR: directory,
    IDP_HOST: "127.0.0.1",
    IDP_PORT: String(idpPort),
    IDP_ISSUER: issuer,
  };
  const envFile = `${directory}/scenario.env`;
  writeFileSync(
    envFile,
    Object.entries(values)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join("\n"),
    { mode: 0o600 },
  );
  return {
    baseUrl,
    issuer,
    env: { ...process.env, ...shared, ...values },
    envFile,
    project: `p15-${basename(directory).toLowerCase()}`,
    cleanup: () => {
      if (!directory.startsWith(`${resolve(".local")}/scenario-`))
        throw new Error("Unsafe scenario root");
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
type ScenarioState = Awaited<ReturnType<typeof isolatedState>>;
export function start(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = process.cwd(),
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString()}`.slice(-2_000);
    });
  child.once("exit", () => {
    if (child.exitCode && diagnostics) console.error(diagnostics.trim());
  });
  return child;
}
export async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    child.kill("SIGTERM");
  });
}
export async function ready(url: string, children: ChildProcess[] = []) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      children.some(
        (child) => child.exitCode !== null || child.signalCode !== null,
      )
    )
      throw new Error("Owned scenario process exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(
    `Scenario listener did not become ready: ${new URL(url).origin}`,
  );
}

class Jar {
  readonly cookies = new Map<string, string>();
  async fetch(url: string | URL, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set(
      "cookie",
      [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    for (const entry of response.headers.getSetCookie()) {
      const pair = entry.split(";", 1)[0];
      const equals = pair?.indexOf("=") ?? -1;
      if (!pair || equals < 1) continue;
      const name = pair.slice(0, equals);
      const value = pair.slice(equals + 1);
      if (/max-age=0(?:;|$)/i.test(entry)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }
}

export async function login(state: ScenarioState, actor: ActorId) {
  const app = new Jar();
  const idp = new Jar();
  let response = await app.fetch(
    `${state.baseUrl}/auth/login?login_hint=${actor}`,
  );
  for (let step = 0; step < 20; step++) {
    const location = response.headers.get("location");
    if (location) {
      const url = new URL(location, response.url);
      if (url.origin === state.baseUrl) {
        assert.equal(url.pathname, "/auth/callback");
        const callback = await app.fetch(url);
        assert.equal(callback.status, 302, `${actor} callback rejected`);
        break;
      }
      assert.equal(url.origin, state.issuer, "unexpected IdP redirect");
      response = await idp.fetch(url);
      continue;
    }
    assert.equal(response.status, 200, "expected provider interaction");
    const html = await response.text();
    const action = html.match(/<form[^>]*action="([^"]+)"/u)?.[1];
    assert(action, "IdP form missing");
    const target = new URL(action.replaceAll("&amp;", "&"), state.issuer);
    assert.equal(target.origin, state.issuer);
    response = await idp.fetch(target, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(
        html.includes('name="login"')
          ? { login: actor, password: "tutorial", prompt: "login" }
          : { prompt: "consent" },
      ),
    });
  }
  const result = await app.fetch(`${state.baseUrl}/api/session`);
  assert.equal(result.status, 200, `${actor} login incomplete`);
  const session = (await result.json()) as SessionView;
  assert.equal(session.user.id, actor);
  return {
    app,
    session,
    async view(caseId: string, intent: ProjectionIntent) {
      const response = await app.fetch(
        `${state.baseUrl}/api/refunds/${caseId}?section=${intent}`,
      );
      assert.equal(
        response.status,
        200,
        `${actor} view failed (${response.status})`,
      );
      return (await response.json()) as RefundViewResult;
    },
    async raw(path: string, body: unknown) {
      return app.fetch(`${state.baseUrl}/api/refunds/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: state.baseUrl,
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify(body),
      });
    },
    async mutate(path: string, body: unknown) {
      const response = await this.raw(path, body);
      assert.equal(
        response.status,
        200,
        `${actor} mutation failed (${response.status})`,
      );
      return (await response.json()) as RefundMutationResult;
    },
  };
}

export async function proveNormal(state: ScenarioState) {
  const bao = await login(state, "bao");
  const sela = await login(state, "sela");
  const diego = await login(state, "diego");
  const nia = await login(state, "nia");
  assert.equal(
    (await bao.view("refund-bao-001", "buyer")).refund.state,
    "eligible",
  );
  const requested = await bao.mutate("refund-bao-001/request", {
    reasonCategory: "damaged",
    reason: "Handle split during delivery.",
    expectedVersion: 0,
  });
  assert.equal(requested.state, "requested");
  const seller = await sela.view("refund-bao-001", "seller");
  assert.equal(seller.refund.state, "requested");
  assert.equal("reason" in seller.refund, false);
  const approved = await diego.mutate("refund-bao-001/approval", {
    expectedVersion: 1,
  });
  assert.equal(approved.state, "approved-awaiting-fraud");
  const completed = await nia.mutate("refund-bao-001/fraud-review", {
    outcome: "clear",
    expectedVersion: 2,
  });
  assert.equal(completed.state, "completed");
  assert.equal(completed.effect?.synthetic, true);
  const repeated = await nia.mutate("refund-bao-001/fraud-review", {
    outcome: "clear",
    expectedVersion: 2,
  });
  assert.equal(repeated.effect?.id, completed.effect?.id);
  console.info(
    "✓ Bao → Sela → Diego → Nia completes one synthetic refund effect",
  );
  return {
    nia,
    async persisted() {
      const current = await nia.view("refund-bao-001", "fraud");
      assert.equal(current.refund.state, "completed");
      const retry = await nia.mutate("refund-bao-001/fraud-review", {
        outcome: "clear",
        expectedVersion: 2,
      });
      assert.equal(retry.effect?.id, completed.effect?.id);
    },
  };
}

export async function proveGaps(state: ScenarioState) {
  const bao = await login(state, "bao");
  const sela = await login(state, "sela");
  const diego = await login(state, "diego");
  const nia = await login(state, "nia");
  assert.equal(
    (await sela.view("refund-scope-gap-001", "seller")).refund.caseId,
    "refund-scope-gap-001",
  );
  console.info("✓ gap 1: Sela reads another store's seller projection");
  await bao.mutate("refund-bao-001/request", {
    reasonCategory: "damaged",
    expectedVersion: 0,
  });
  assert.equal(
    (await bao.mutate("refund-bao-001/approval", { expectedVersion: 1 })).state,
    "approved-awaiting-fraud",
  );
  console.info(
    "✓ gap 2: Bao invokes support approval as the requester and buyer",
  );
  assert.equal(
    (
      await diego.mutate("refund-scope-gap-001/approval", {
        expectedVersion: 1,
      })
    ).state,
    "approved-awaiting-fraud",
  );
  console.info("✓ gap 3: Diego approves outside assignment and above limit");
  const [clear, block] = await Promise.all([
    nia.raw("refund-bao-001/fraud-review", {
      outcome: "clear",
      expectedVersion: 2,
    }),
    nia.raw("refund-bao-001/fraud-review", {
      outcome: "block",
      expectedVersion: 2,
    }),
  ]);
  assert.deepEqual([clear.status, block.status].sort(), [200, 409]);
  const terminal = await nia.view("refund-bao-001", "fraud");
  assert(["completed", "fraud-blocked"].includes(terminal.refund.state));
  const blocked = await nia.mutate("refund-scope-gap-001/fraud-review", {
    outcome: "block",
    expectedVersion: 2,
  });
  assert.equal(blocked.state, "fraud-blocked");
  assert.equal(blocked.effect, undefined);
  console.info(
    "✓ clear/block race selects one terminal outcome; block creates no effect",
  );
}
