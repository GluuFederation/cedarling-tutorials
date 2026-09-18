import { createApp } from "./app.js";
import { loadConfig } from "./config/project-config.js";
import { loadProjectEnvironment } from "./config/environment.js";
import { createRuntime } from "./runtime.js";

loadProjectEnvironment();
console.info("P2 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
const runtime = await createRuntime(config);
const app = createApp(runtime);

await app.listen({ host: config.host, port: config.port });
console.log(`P2 TenantRAG listening at ${config.baseUrl}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`Received ${signal}; stopping P2 TenantRAG`);
    void app.close().finally(() => process.exit(0));
  });
}
