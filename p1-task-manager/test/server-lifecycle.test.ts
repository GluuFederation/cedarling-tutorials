import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildPolicyStore } from "../../shared/policy-store.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(new URL("../src/server/main.ts", import.meta.url));
const loader = createRequire(import.meta.url).resolve("tsx");
let root: string;
let issuer: Server | undefined;

beforeAll(async () => {
  const jwk = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).publicKey.export({ format: "jwk" });
  issuer = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/jwks"
          ? {
              keys: [{ ...jwk, kid: "lifecycle", use: "sig", alg: "RS256" }],
            }
          : {
              issuer: "http://localhost:18001",
              jwks_uri: "http://localhost:18001/jwks",
              authorization_endpoint: "http://localhost:18001/auth",
              token_endpoint: "http://localhost:18001/token",
            },
      ),
    );
  });
  await new Promise<void>((resolve, reject) => {
    issuer!.once("error", reject);
    issuer!.listen(18001, resolve);
  });
  root = await mkdtemp(join(tmpdir(), "p1-lifecycle-"));
  await cp(join(projectRoot, "policy-store"), join(root, "policy-store"), {
    recursive: true,
  });
  await buildPolicyStore({ projectRoot: root, dependencyRoot: projectRoot });
  await mkdir(join(root, "dist/web"), { recursive: true });
  await writeFile(
    join(root, "dist/web/index.html"),
    "<!doctype html><title>P1 lifecycle</title>",
  );
}, 30_000);

afterAll(async () => {
  issuer?.closeAllConnections();
  if (issuer?.listening)
    await new Promise<void>((resolve) => {
      issuer!.close(() => resolve());
    });
  if (root) await rm(root, { recursive: true, force: true });
});

async function stopApplication(signal: string, mode = "normal") {
  // Fastify's public diagnostics channel lets a test plugin delay or fail cleanup.
  const script = `
    import { subscribe } from 'node:diagnostics_channel';
    import { pathToFileURL } from 'node:url';
    subscribe('fastify.initialization', ({ fastify }) => {
      fastify.addHook('onClose', async () => {
        console.log('lifecycle-close-start');
        if (process.env.LIFECYCLE_MODE === 'hang') await new Promise(() => {});
        if (process.env.LIFECYCLE_MODE === 'error') throw new Error('private-cleanup-detail');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (process.env.LIFECYCLE_MODE === 'output') {
          process.stdout.write('x'.repeat(256 * 1024) + 'lifecycle-output-finished\\n');
        }
        console.log('lifecycle-close-finished');
      });
    });
    await import(pathToFileURL(process.env.LIFECYCLE_ENTRY).href);
    console.log('lifecycle-ready');
    process.on('message', () => {
      process.emit(process.env.LIFECYCLE_SIGNAL, process.env.LIFECYCLE_SIGNAL);
      if (process.env.LIFECYCLE_MODE === 'repeat') {
        process.emit('SIGINT', 'SIGINT');
        process.emit('SIGTERM', 'SIGTERM');
      }
      process.disconnect();
    });
  `;
  const child = spawn(
    process.execPath,
    ["--import", loader, "--input-type=module", "-e", script],
    {
      cwd: root,
      env: {
        ...process.env,
        P1_PROJECT_ROOT: root,
        P1_DATA_DIR: ".data",
        P1_HOST: "127.0.0.1",
        P1_PORT: "17001",
        P1_BASE_URL: "http://localhost:17001",
        P1_ISSUER: "http://localhost:18001",
        P1_API_RESOURCE: "http://localhost:17001/api",
        P1_CLIENT_ID: "p1-task-manager",
        P1_CLIENT_SECRET: "lifecycle-only-secret".repeat(3),
        P1_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64url"),
        LIFECYCLE_ENTRY: entry,
        LIFECYCLE_SIGNAL: signal,
        LIFECYCLE_MODE: mode,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  let error = "";
  let ready = false;
  let timedOut = false;
  const startupTimeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 10_000);
  let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;
  child.stdout!.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (!ready && output.includes("lifecycle-ready")) {
      ready = true;
      clearTimeout(startupTimeout);
      shutdownTimeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 5_000);
      // POSIX runs also cover delivery of actual operating-system signals.
      if (process.platform !== "win32" && mode === "normal") {
        child.disconnect();
        child.kill(signal as NodeJS.Signals);
      } else child.send("stop");
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    error += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => {
    clearTimeout(startupTimeout);
    clearTimeout(shutdownTimeout);
  });
  return { code, output, error, ready, timedOut };
}

test.each(["SIGINT", "SIGTERM"])(
  "P1 exits after %s with a real Cedarling instance",
  async (signal) => {
    const result = await stopApplication(signal);
    expect(result.ready, result.error).toBe(true);
    expect(result.output).toContain("lifecycle-close-finished");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  },
  20_000,
);

test("repeated shutdown signals wait for one cleanup", async () => {
  const result = await stopApplication("SIGTERM", "repeat");
  expect(result.ready, result.error).toBe(true);
  expect(result.output.match(/lifecycle-close-start/g)).toHaveLength(1);
  expect(result.output).toContain("lifecycle-close-finished");
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
}, 20_000);

test("shutdown flushes pending output before exiting", async () => {
  const result = await stopApplication("SIGTERM", "output");
  expect(result.output).toContain(
    "x".repeat(256 * 1024) + "lifecycle-output-finished",
  );
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
}, 20_000);

test("cleanup failure exits unsuccessfully without exposing the error", async () => {
  const result = await stopApplication("SIGTERM", "error");
  expect(result.ready, result.error).toBe(true);
  expect(result.error).toContain("P1 shutdown failed");
  expect(result.error).not.toContain("private-cleanup-detail");
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(1);
}, 20_000);

test("stalled cleanup exits within the shutdown deadline", async () => {
  const result = await stopApplication("SIGTERM", "hang");
  expect(result.ready, result.error).toBe(true);
  expect(result.output).not.toContain("lifecycle-close-finished");
  expect(result.error).toContain("P1 shutdown timed out");
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(1);
}, 20_000);
