/** Watches the P1 browser bundle and server, and stops both as one process. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCommand } from "../../shared/dev-supervisor.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [];
let stopping = false;
let rejectFailure;
const failure = new Promise((_, reject) => {
  rejectFailure = reject;
});
failure.catch(() => undefined);

function watch(name, args) {
  const command = resolveCommand(pnpm, args);
  const child = spawn(command.command, command.args, {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  child.once("error", (error) => {
    if (!stopping)
      rejectFailure(new Error(`${name} could not start: ${error.message}`));
  });
  child.once("exit", (code, signal) => {
    if (!stopping)
      rejectFailure(
        new Error(
          `${name} exited${signal ? ` after ${signal}` : ` with exit code ${code}`}`,
        ),
      );
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode === null)
        await Promise.race([once(child, "exit"), timeout()]);
    }),
  );
}

function timeout() {
  return new Promise((resolveTimeout) => {
    const timer = setTimeout(resolveTimeout, 5_000);
    timer.unref();
  });
}

let resolveSignal;
const signalReceived = new Promise((resolveSignalPromise) => {
  resolveSignal = resolveSignalPromise;
});
const handlers = new Map();
for (const signal of ["SIGINT", "SIGTERM"]) {
  const handler = () => resolveSignal(signal);
  handlers.set(signal, handler);
  process.once(signal, handler);
}

try {
  watch("P1 browser watcher", ["exec", "vite", "build", "--watch"]);
  watch("P1 server watcher", ["exec", "tsx", "watch", "src/server/main.ts"]);
  await Promise.race([failure, signalReceived]);
} catch (error) {
  console.error(
    `P1 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await stop();
}
