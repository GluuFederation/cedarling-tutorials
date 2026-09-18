import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  proveAuthorizationFlow,
  provePersistence,
  scenarioEnvironment,
  waitFor,
} from "./scenario-support.ts";

const scenario = await scenarioEnvironment();
const children: ChildProcess[] = [];
function start(args: string[], cwd: string, env = scenario.env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.push(child);
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    child.kill("SIGTERM");
  });
}
let success = false;
try {
  const idp = start(
    ["--import", "tsx", "src/main.ts"],
    resolve("../shared/identity-provider"),
  );
  await waitFor(
    `${scenario.config.issuer}/.well-known/openid-configuration`,
    () => idp.exitCode === null && idp.signalCode === null,
  );
  let app = start(["src/server/main.ts"], process.cwd());
  await waitFor(
    `${scenario.config.baseUrl}/health`,
    () => app.exitCode === null && app.signalCode === null,
  );
  const id = await proveAuthorizationFlow(scenario.config);
  await stop(app);
  app = start(["src/server/main.ts"], process.cwd());
  await waitFor(
    `${scenario.config.baseUrl}/health`,
    () => app.exitCode === null && app.signalCode === null,
  );
  await provePersistence(scenario.config, id);
  success = true;
  console.info("P12 native OIDC permissive passed. Cedarling was not called.");
} finally {
  for (const child of children.reverse()) await stop(child);
  if (success) scenario.cleanup();
  else
    console.error(
      `Failed scenario artifacts retained at ${scenario.directory}`,
    );
}
