import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildPolicyStore } from "../../shared/policy-store.mjs";
import { loadAllFixtures } from "../src/rag/pdf.js";
import {
  createCorpusArtifact,
  writeCorpusArtifact,
} from "../src/rag/corpus.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
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
              issuer: "http://localhost:18002",
              jwks_uri: "http://localhost:18002/jwks",
              authorization_endpoint: "http://localhost:18002/auth",
              token_endpoint: "http://localhost:18002/token",
            },
      ),
    );
  });
  await new Promise<void>((resolve, reject) => {
    issuer!.once("error", reject);
    issuer!.listen(18002, resolve);
  });
  root = await mkdtemp(join(tmpdir(), "p2-lifecycle-"));
  await cp(join(projectRoot, "policy-store"), join(root, "policy-store"), {
    recursive: true,
  });
  await buildPolicyStore({ projectRoot: root, dependencyRoot: projectRoot });
  await cp(join(projectRoot, "fixtures"), join(root, "fixtures"), {
    recursive: true,
  });
  const documents = await loadAllFixtures(join(root, "fixtures"));
  const artifact = await createCorpusArtifact(
    documents,
    { embed: async (texts) => texts.map(() => Array<number>(256).fill(0)) },
    "voyage-4-lite",
  );
  await writeCorpusArtifact(join(root, "data/orama-index.json"), artifact);
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
        P2_PROJECT_ROOT: root,
        P2_HOST: "127.0.0.1",
        P2_PORT: "17002",
        P2_BASE_URL: "http://localhost:17002",
        P2_ISSUER: "http://localhost:18002",
        P2_API_RESOURCE: "http://localhost:17002/api",
        P2_CLIENT_ID: "p2-tenantrag-cli",
        P2_VOYAGE_API_KEY: "lifecycle-test-only",
        P2_OPENROUTER_API_KEY: "lifecycle-test-only",
        P2_OPENROUTER_MODEL: "openrouter/free",
        P2_OPENROUTER_ALLOW_PAID: "false",
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
        child.kill(signal as NodeJS.Signals);
      } else child.send("stop");
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    error += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(startupTimeout);
    clearTimeout(shutdownTimeout);
  });
  return { code, output, error, ready, timedOut };
}

test.each(["SIGINT", "SIGTERM"])(
  "P2 exits after %s with a real Cedarling instance",
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
  expect(
    result.output.includes(
      "x".repeat(256 * 1024) + "lifecycle-output-finished",
    ),
  ).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
}, 20_000);

test("cleanup failure exits unsuccessfully without exposing the error", async () => {
  const result = await stopApplication("SIGTERM", "error");
  expect(result.ready, result.error).toBe(true);
  expect(result.error).toContain("P2 shutdown failed");
  expect(result.error).not.toContain("private-cleanup-detail");
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(1);
}, 20_000);

test("stalled cleanup exits within the shutdown deadline", async () => {
  const result = await stopApplication("SIGTERM", "hang");
  expect(result.ready, result.error).toBe(true);
  expect(result.output).not.toContain("lifecycle-close-finished");
  expect(result.error).toContain("P2 shutdown timed out");
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(1);
}, 20_000);
