/** Runs the real P3 stack in an isolated Compose project, including sidecar outage and recovery. */
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const directory = await mkdtemp(join(tmpdir(), "p3-verify-"));
const project = `p3-verify-${process.pid}`;
const file = join(directory, "compose.json");
const config = JSON.parse(
  execFileSync("docker", ["compose", "config", "--format", "json"], {
    encoding: "utf8",
  }),
) as {
  name: string;
  services: Record<
    string,
    { ports?: { target: number; published: string; host_ip: string }[] }
  >;
  volumes: Record<string, { name: string }>;
  networks: Record<string, { name: string }>;
};
config.name = project;
for (const [key, value] of Object.entries(config.volumes))
  value.name = `${project}_${key}`;
for (const [key, value] of Object.entries(config.networks))
  value.name = `${project}_${key}`;
const identityProvider = config.services["identity-provider"];
assert.ok(identityProvider);
identityProvider.ports = [17003, 18003].map((target) => ({
  target,
  published: "0",
  host_ip: "127.0.0.1",
}));
await writeFile(file, JSON.stringify(config));

async function compose(...args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["compose", "--project-name", project, "--file", file, ...args],
      { stdio: "inherit", timeout: 240_000 },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Compose ${args[0]} failed (${code})`)),
    );
  });
}

/** Coordinates two bounded checkpoints without replacing the authenticated client. */
async function verifyStack(): Promise<void> {
  const child = spawn(
    "docker",
    [
      "compose",
      "--project-name",
      project,
      "--file",
      file,
      "exec",
      "-T",
      "incident-assistant",
      "node",
      "dist/scripts/verify-stack.js",
    ],
    { stdio: ["pipe", "pipe", "inherit"], timeout: 180_000 },
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdin.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Stack verifier failed (${code})`)),
    );
  });
  const lines = createInterface({ input: child.stdout });
  const checkpoints = ["P3_VERIFY_STOP_SIDECAR", "P3_VERIFY_START_SIDECAR"];
  let completed = 0;
  try {
    await Promise.all([
      exited,
      (async () => {
        for await (const line of lines) {
          console.info(line);
          if (!line.startsWith("P3_VERIFY_")) continue;
          assert.equal(
            line,
            checkpoints[completed],
            "Unexpected verifier checkpoint",
          );
          if (completed === 0) {
            await compose("stop", "cedarling");
            child.stdin.write("stopped\n");
          } else {
            await compose(
              "up",
              "--detach",
              "--no-deps",
              "--wait",
              "--wait-timeout",
              "60",
              "cedarling",
            );
            child.stdin.write("started\n");
          }
          completed++;
        }
      })(),
    ]);
    assert.equal(
      completed,
      checkpoints.length,
      "Verifier did not complete outage checks",
    );
  } finally {
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
}

try {
  await compose("up", "--build", "--detach", "--wait", "--wait-timeout", "180");
  await verifyStack();
  const logs = execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      project,
      "--file",
      file,
      "logs",
      "--no-color",
      "cedarling",
    ],
    { encoding: "utf8" },
  );
  assert.ok(
    !logs.includes("could not set token to token cache"),
    "Token cache warnings must not obscure decisions",
  );
  assert.ok(
    !logs.includes('"GET /.well-known/authzen-configuration HTTP'),
    "Health checks must not flood the access log",
  );
  assert.ok(
    logs.includes('"log_kind":"Decision"'),
    "Native Cedarling decision evidence must remain visible",
  );
  console.info(
    "P3 Compose workflow, denied access, sidecar outage, and recovery passed.",
  );
} catch (error) {
  await compose("logs", "--no-color", "--tail", "80").catch(() => undefined);
  throw error;
} finally {
  await compose("down", "--volumes", "--remove-orphans");
  await rm(directory, { recursive: true, force: true });
}
