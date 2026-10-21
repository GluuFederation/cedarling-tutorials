import { loadConsoleConfig } from "./config.ts";
import { createConsoleApp } from "./console-app.ts";
import { loadLocalEnvironment } from "./environment.ts";
import { listen, shutdown } from "./runtime.ts";

loadLocalEnvironment();
const config = loadConsoleConfig();
const app = await createConsoleApp(config);
await listen(app, "P10 CedarStock", config.host, config.port, config.baseUrl);
shutdown(app);
