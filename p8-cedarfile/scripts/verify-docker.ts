import { spawnSync } from "node:child_process";
import { assertScenarioIdle } from "./scenario-safety.ts";

const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `p8-scenario-${process.pid}`,
};

function runningServices(): string {
  const result = spawnSync(
    "docker",
    ["compose", "ps", "--services", "--filter", "status=running"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (result.status !== 0) {
    throw new Error("Docker Compose preflight failed");
  }
  return result.stdout;
}

// Refuse to take ownership of ports or containers used by a learner session.
assertScenarioIdle(runningServices());

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

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:3008/health");
      if (response.ok) return;
    } catch {
      // A start or restart briefly closes the listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The P8 container did not become healthy");
}

function runInside(phase: "--exercise" | "--after-restart"): void {
  compose(
    "exec",
    "-T",
    "cedarfile",
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
    "cedarfile",
    "node",
    "-e",
    "const fs=require('node:fs');const s=fs.lstatSync('/data/p8.sqlite');if(!s.isFile()||s.isSymbolicLink()||s.size===0)process.exit(1)",
  );
}

async function exerciseScenario(): Promise<void> {
  compose("up", "--build", "--wait");
  await waitForHealth();

  const login = await fetch(
    "http://127.0.0.1:3008/auth/login?login_hint=jordan",
    { redirect: "manual" },
  );
  const location = login.headers.get("location");
  if (
    login.status !== 302 ||
    !location?.startsWith("http://idp.localhost:4000/")
  ) {
    throw new Error(
      "The P8 container could not reach the configured OIDC issuer",
    );
  }

  compose(
    "exec",
    "-T",
    "cedarfile",
    "node",
    "-e",
    "const fs=require('node:fs');fs.accessSync('/data',fs.constants.R_OK|fs.constants.W_OK);const s=fs.lstatSync('/data');if(!s.isDirectory()||s.isSymbolicLink())process.exit(1)",
  );
  runInside("--exercise");
  persistedDatabase();

  compose("restart", "cedarfile");
  await waitForHealth();
  persistedDatabase();
  runInside("--after-restart");

  console.log(
    "P8 Docker scenario passed: OIDC, /data operations, three gaps, and restart persistence",
  );
}

let runError: unknown;
try {
  await exerciseScenario();
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
    "P8 scenario and cleanup both failed",
  );
}
if (runError !== undefined) throw runError;
if (downError !== undefined) throw downError;
