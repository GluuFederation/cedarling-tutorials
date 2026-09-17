import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { exercise, verifyPersistence } from "./scenario-proof.ts";
import {
  removeScenario,
  scenarioEnvironment,
  start,
  stop,
  waitHealthy,
} from "./scenario-support.ts";

process.umask(0o077);
const scenario = await scenarioEnvironment();
const processes: ReturnType<typeof start>[] = [];
try {
  const issuerMain = resolve("../shared/identity-provider/dist/main.js");
  if (!existsSync(issuerMain))
    throw new Error(
      "Build the shared IdP first: pnpm --dir ../shared/identity-provider build",
    );
  const issuer = start(
    process.execPath,
    [issuerMain],
    scenario.env,
    scenario.root,
  );
  processes.push(issuer);
  await waitHealthy(
    `${scenario.config.issuer}/.well-known/openid-configuration`,
    issuer,
  );
  let app = start(
    process.execPath,
    [resolve("src/server/main.ts")],
    scenario.env,
  );
  processes.push(app);
  await waitHealthy(`${scenario.config.baseUrl}/health`, app);
  const client = await exercise(
    scenario.config,
    resolve(scenario.config.dataDir, "school.sqlite"),
  );
  await stop(app);
  app = start(process.execPath, [resolve("src/server/main.ts")], scenario.env);
  processes.push(app);
  await waitHealthy(`${scenario.config.baseUrl}/health`, app);
  await verifyPersistence(client);
} finally {
  for (const child of processes.reverse()) await stop(child);
  removeScenario(scenario.root);
}
console.info(
  "P13 native permissive passed; isolated scenario state removed, learner state untouched.",
);
