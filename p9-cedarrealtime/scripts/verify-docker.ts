import { spawnSync } from "node:child_process";
import { assertScenarioIdle } from "./scenario-safety.ts";

const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `p9-scenario-${process.pid}`,
};

function composeOutput(...arguments_: string[]): string {
  const result = spawnSync("docker", ["compose", ...arguments_], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error("Docker Compose preflight failed");
  return result.stdout;
}

assertScenarioIdle(
  composeOutput("ps", "--services", "--filter", "status=running"),
);

function compose(...arguments_: string[]): void {
  const result = spawnSync("docker", ["compose", ...arguments_], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `Docker Compose command failed: ${arguments_[0] ?? "unknown"}`,
    );
  }
}

async function health(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:3009/health");
      if (response.ok) return;
    } catch {
      // Startup and restart briefly close the listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("P9 container did not become healthy");
}

function runInside(phase: "--exercise" | "--after-restart"): void {
  compose(
    "exec",
    "-T",
    "cedarrealtime",
    "node",
    "--env-file=/run/config/app.env",
    "dist/scripts/e2e-proof.js",
    phase,
  );
}

function persistedDatabase(): void {
  compose(
    "exec",
    "-T",
    "cedarrealtime",
    "node",
    "-e",
    "const fs=require('node:fs');const s=fs.lstatSync('/data/p9.sqlite');if(!s.isFile()||s.isSymbolicLink()||s.size===0)process.exit(1)",
  );
}

async function exercise(): Promise<void> {
  compose("up", "--build", "--wait");
  await health();
  runInside("--exercise");
  persistedDatabase();
  compose("restart", "cedarrealtime");
  await health();
  persistedDatabase();
  runInside("--after-restart");
  console.log(
    "P9 Docker scenario passed: real OIDC, three gaps and restart persistence",
  );
}

let runError: unknown;
try {
  await exercise();
} catch (error) {
  runError = error;
}
let downError: unknown;
try {
  compose("down", "--volumes", "--remove-orphans");
} catch (error) {
  downError = error;
}
if (runError !== undefined && downError !== undefined) {
  throw new AggregateError(
    [runError, downError],
    "P9 scenario and cleanup failed",
  );
}
if (runError !== undefined) throw runError;
if (downError !== undefined) throw downError;
