import { spawn } from "node:child_process";
import {
  proveAuthorizationFlow,
  provePersistence,
  scenarioEnvironment,
  waitFor,
} from "./scenario-support.ts";

const scenario = await scenarioEnvironment(true);
const name = `p12-scenario-${process.pid}`;
function compose(...args: string[]) {
  return new Promise<void>((done, reject) => {
    const child = spawn(
      "docker",
      ["compose", "-p", name, "-f", "compose.yaml", ...args],
      { env: scenario.env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(
            new Error(
              `Owned Docker scenario command ${args[0]} failed (${code})`,
            ),
          ),
    );
  });
}
let success = false;
try {
  await compose("config", "--quiet");
  await compose("up", "--build", "--wait");
  const id = await proveAuthorizationFlow(scenario.config);
  await compose("restart", "cedarhr");
  await waitFor(`${scenario.config.baseUrl}/health`);
  await provePersistence(scenario.config, id);
  success = true;
  console.info("P12 Docker OIDC, gap and persistence checks passed.");
} finally {
  await compose("down", "--remove-orphans");
  if (success) scenario.cleanup();
  else
    console.error(
      `Failed scenario artifacts retained at ${scenario.directory}`,
    );
}
