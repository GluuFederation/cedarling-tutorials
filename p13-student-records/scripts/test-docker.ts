import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { prepareData } from "../src/server/config/environment.ts";
import { exercise, verifyPersistence } from "./scenario-proof.ts";
import { openSession } from "./scenario-session.ts";
import {
  removeScenario,
  scenarioEnvironment,
  waitHealthy,
} from "./scenario-support.ts";

const scenario = await scenarioEnvironment();
const project = `p13-check-${process.pid}`;
const env = {
  ...scenario.env,
  COMPOSE_PROJECT_NAME: project,
  P13_IDP_PORT: new URL(scenario.config.issuer).port,
  P13_HOST_DATA_DIR: scenario.config.dataDir,
};
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
        : reject(new Error(`P13 Docker check failed (exit ${code})`)),
    );
  });
}
let success = false;
try {
  prepareData(scenario.config);
  await compose(["up", "--build", "--wait", "--wait-timeout", "90"]);
  await waitHealthy(`${scenario.config.baseUrl}/health`);
  const client = await exercise(
    scenario.config,
    `${scenario.config.dataDir}/school.sqlite`,
  );
  await compose(["restart", "cedarschool"]);
  await waitHealthy(`${scenario.config.baseUrl}/health`);
  await verifyPersistence(client);
  await compose(["stop", "cedarschool"]);
  await compose([
    "run",
    "--rm",
    "--no-deps",
    "cedarschool",
    "node",
    "--env-file=/run/config/app.env",
    "dist/server/data/reset.js",
  ]);
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
  const fresh = await openSession(scenario.config, "talia");
  const result = await fresh.request("/api/grades/teacher/grade-sam-1");
  assert.equal(result.status, 200);
  assert.equal(
    ((await result.json()) as { grade: { state: string } }).grade.state,
    "draft",
  );
  success = true;
  console.info(
    "P13 Docker proof passed: six identities, directory, publication, audience projections, persistence and documented reset.",
  );
} finally {
  await compose(["down", "--volumes", "--remove-orphans"]);
  if (success) removeScenario(scenario.root);
  else console.error(`P13 failed Docker scenario retained at ${scenario.root}`);
}
