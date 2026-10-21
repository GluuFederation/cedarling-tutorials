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
      const response = await fetch("http://127.0.0.1:17011/health", {
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
  const databaseTests = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "vitest", "run", "test/database.integration.test.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        P11_TEST_DATABASE_URL: "postgresql://p11:p11@127.0.0.1:5435/p11",
      },
      stdio: "inherit",
    },
  );
  if (databaseTests.status !== 0)
    throw new Error("P11 PostgreSQL lifecycle checks failed");
  // Each replay batch has its own normal per-process HTTP request budget.
  playwright("@visual|@responsive.*editing");
  compose("restart", "cedarworkspace");
  await waitForApplication();
  playwright("@responsive.*invitation");
  compose("restart", "cedarworkspace");
  await waitForApplication();
  playwright("@forms|@exercise|@recovery");
  compose("restart", "cedarworkspace");
  await waitForApplication();
  playwright("@limits");
  compose("restart", "cedarworkspace");
  await waitForApplication();
  playwright("@persistence");
  compose(
    "exec",
    "-T",
    "cedarworkspace",
    "node",
    "--env-file=/run/config/app.env",
    "scripts/reset.ts",
  );
  compose("restart", "cedarworkspace");
  await waitForApplication();
  playwright("@workflow");
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
