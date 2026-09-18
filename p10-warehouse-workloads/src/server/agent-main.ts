import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { type WorkloadId, workloadIds } from "../shared/catalog.ts";
import { createAgentApp } from "./agent-app.ts";
import { loadAgentConfig } from "./config.ts";
import { createWorkloadTokens } from "./oidc.ts";
import { listen, shutdown } from "./runtime.ts";

if (existsSync(resolve(".env"))) loadEnvFile(resolve(".env"));
const selected = process.argv[2] ?? process.env.P10_WORKLOAD_ID;
if (!selected || !workloadIds.has(selected as WorkloadId)) {
  throw new Error("P10 agent requires a registered workload ID");
}
const config = loadAgentConfig(selected as WorkloadId);
const app = await createAgentApp(config, await createWorkloadTokens(config));
await listen(app, `P10 ${config.workloadId} agent`, config.host, config.port);
shutdown(app);
