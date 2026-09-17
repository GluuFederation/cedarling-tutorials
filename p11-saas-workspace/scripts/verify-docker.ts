import { spawnSync } from "node:child_process";

const projectName = `p11-scenario-${process.pid}`;
const environment = { ...process.env, COMPOSE_PROJECT_NAME: projectName };

function compose(...args: string[]): void {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Docker Compose failed during ${args[0] ?? "unknown"}`);
  }
}

function playwright(grep: string): void {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    executable,
    ["exec", "playwright", "test", "--grep", grep],
    {
      cwd: process.cwd(),
      env: { ...environment, P11_E2E_EXTERNAL: "1" },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error(`P11 browser proof failed: ${grep}`);
}

function ensureIdle(): void {
  const result = spawnSync(
    "docker",
    ["compose", "ps", "--services", "--filter", "status=running"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("Docker Compose preflight failed");
  if (result.stdout.trim()) {
    throw new Error("P11 scenario refuses to replace a running learner stack");
  }
}

async function waitForApplication(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3011/health", {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The bounded retry below covers the expected restart connection gap.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("P11 application did not become healthy after restart");
}

async function verify(): Promise<void> {
  ensureIdle();
  compose("up", "--build", "--wait");
  playwright("@exercise");
  compose("restart", "cedarworkspace");
  await waitForApplication();
  playwright("@persistence");
  console.log(
    "P11 Docker browser proof passed: OIDC, three gaps, controls, and restart persistence",
  );
}

let failure: unknown;
try {
  await verify();
} catch (error) {
  failure = error;
}
try {
  compose("down", "--volumes", "--remove-orphans");
} catch (cleanupError) {
  if (failure)
    throw new AggregateError(
      [failure, cleanupError],
      "P11 scenario and cleanup failed",
    );
  throw cleanupError;
}
if (failure) throw failure;
