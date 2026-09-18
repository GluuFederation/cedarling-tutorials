import { loadProjectEnvironment } from "./config/environment.js";
import { loadConfig } from "./config/project-config.js";
import { createRuntime } from "./runtime.js";

loadProjectEnvironment();
console.info("P3 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
const runtime = await createRuntime(config);
const listener = runtime.app.listen(config.port, config.host, () => {
  console.log(`P3 MCP server listening at ${config.mcpResource}`);
});

async function shutdown(): Promise<void> {
  await runtime.close();
  listener.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
