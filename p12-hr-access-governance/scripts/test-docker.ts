import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openScenarioSession } from "./scenario-session.ts";
import {
  proveAuthorizationFlow,
  provePersistence,
  scenarioEnvironment,
  waitFor,
} from "./scenario-support.ts";

const scenario = await scenarioEnvironment();
const project = `p12-check-${process.pid}`;
const env = { ...scenario.env, COMPOSE_PROJECT_NAME: project };
async function compose(args: string[]) {
  await new Promise<void>((done, reject) => {
    const child = spawn("docker", ["compose", "-p", project, ...args], {
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(
            new Error(`P12 disposable Docker check failed (exit ${code})`),
          ),
    );
  });
}
let success = false;
try {
  await compose(["up", "--build", "--wait", "--wait-timeout", "90"]);
  await waitFor(`${scenario.config.baseUrl}/health`);
  const id = await proveAuthorizationFlow(scenario.config);
  await compose(["restart", "cedarhr"]);
  await waitFor(`${scenario.config.baseUrl}/health`);
  await provePersistence(scenario.config, id);
  await compose(["stop", "cedarhr"]);
  await compose([
    "run",
    "--rm",
    "--no-deps",
    "cedarhr",
    "node",
    "--env-file=/run/config/app.env",
    "dist/server/data/reset.js",
  ]);
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
  await waitFor(`${scenario.config.baseUrl}/health`);
  const fresh = await openScenarioSession(scenario.config, "lin");
  const grants = await fresh.request("/api/grants");
  assert.equal(grants.status, 200);
  assert.deepEqual((await grants.json()).data, []);
  success = true;
  console.info(
    "P12 Docker proof passed: OIDC, seven seams, independent grants, restart persistence and documented reset.",
  );
} finally {
  await compose(["down", "--volumes", "--remove-orphans"]);
  if (success) scenario.cleanup();
  else console.error(`P12 failed scenario retained at ${scenario.directory}`);
}
