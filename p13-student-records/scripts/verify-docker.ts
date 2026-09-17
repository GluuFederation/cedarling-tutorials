import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exercise, verifyPersistence } from "./scenario-proof.ts";
import {
  removeScenario,
  scenarioEnvironment,
  waitHealthy,
} from "./scenario-support.ts";

process.umask(0o077);
const scenario = await scenarioEnvironment();
const identityEnv = resolve(scenario.root, "identity.env");
writeFileSync(
  identityEnv,
  `${Object.entries(scenario.identity)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`,
  { mode: 0o600, flag: "wx" },
);
mkdirSync(scenario.config.dataDir, { recursive: true, mode: 0o700 });
const environment: NodeJS.ProcessEnv = {
  ...scenario.env,
  COMPOSE_PROJECT_NAME: `p13-scenario-${process.pid}`,
  P13_IDP_ENV_FILE: identityEnv,
  P13_IDP_PORT: scenario.env.IDP_PORT,
  P13_HOST_DATA_DIR: scenario.config.dataDir,
};
function compose(...args: string[]): void {
  const result = spawnSync(
    "docker",
    ["compose", "--env-file", identityEnv, ...args],
    { cwd: process.cwd(), env: environment, stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new Error(`P13 isolated Compose ${args[0]} failed`);
}
let failure: unknown;
try {
  compose("config", "--quiet");
  compose("up", "--build", "--wait");
  const client = await exercise(
    scenario.config,
    resolve(scenario.config.dataDir, "school.sqlite"),
  );
  compose("restart", "cedarschool");
  await waitHealthy(`${scenario.config.baseUrl}/health`);
  await verifyPersistence(client);
} catch (error) {
  failure = error;
}
try {
  compose("down", "--remove-orphans");
  removeScenario(scenario.root);
} catch (error) {
  throw new AggregateError(
    [failure, error].filter(Boolean),
    "P13 scenario cleanup failed; its isolated data was retained",
  );
}
if (failure) throw failure;
console.info(
  "P13 Docker permissive passed; its containers and isolated state were removed, learner state untouched.",
);
