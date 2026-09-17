import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { loadConfig } from "../src/server/config.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to allocate scenario port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
export async function scenarioEnvironment() {
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  const root = mkdtempSync(resolve(".local/p13-scenario-"));
  const appPort = await freePort();
  let issuerPort = await freePort();
  while (issuerPort === appPort) issuerPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const issuer = `http://127.0.0.1:${issuerPort}`;
  const clientSecretNames = [
    "P1_CLIENT_SECRET",
    "P4_CLIENT_SECRET",
    "P5_CLIENT_SECRET",
    "P6_CLIENT_SECRET",
    "P7_CLIENT_SECRET",
    "P8_CLIENT_SECRET",
    "P9_CLIENT_SECRET",
    "P10_TRANSFER_PLANNER_CLIENT_SECRET",
    "P10_WAREHOUSE_NORTH_CLIENT_SECRET",
    "P10_WAREHOUSE_SOUTH_CLIENT_SECRET",
    "P10_INVENTORY_AUDITOR_CLIENT_SECRET",
    "P11_CLIENT_SECRET",
    "P13_CLIENT_SECRET",
  ] as const;
  const secrets = Object.fromEntries(
    clientSecretNames.map((name) => [
      name,
      randomBytes(32).toString("base64url"),
    ]),
  );
  const identity = {
    ...secrets,
    IDP_PROFILE: "default",
    IDP_HOST: "127.0.0.1",
    IDP_PORT: String(issuerPort),
    IDP_ISSUER: issuer,
    P13_CLIENT_ID: "p13-student-records",
    P13_API_RESOURCE: `${baseUrl}/api`,
    P13_REDIRECT_URI: `${baseUrl}/auth/callback`,
    P13_POST_LOGOUT_REDIRECT_URI: baseUrl,
  };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...identity,
    P12_CLIENT_SECRET: undefined,
    P14_CLIENT_SECRET: undefined,
    P13_BASE_URL: baseUrl,
    P13_ISSUER: issuer,
    P13_HOST: "127.0.0.1",
    P13_PORT: String(appPort),
    P13_DATA_DIR: resolve(root, "data"),
    NODE_ENV: "test",
  };
  return { root, env, identity, config: loadConfig(env) };
}
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
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
export async function waitHealthy(
  url: string,
  child?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error("Scenario service exited before readiness");
    try {
      if (
        (
          await fetch(url, {
            headers: { Connection: "close" },
            signal: AbortSignal.timeout(500),
          })
        ).ok
      )
        return;
    } catch {
      /* Bounded startup retry. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Scenario service did not become ready within 10 seconds");
}
export async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("error", reject);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
export function removeScenario(root: string): void {
  if (
    dirname(root) !== resolve(".local") ||
    !basename(root).startsWith("p13-scenario-") ||
    !lstatSync(root, { throwIfNoEntry: false })?.isDirectory() ||
    lstatSync(root).isSymbolicLink()
  )
    throw new Error(
      "Refusing cleanup outside the created P13 scenario directory",
    );
  rmSync(root, { recursive: true, force: true });
}
