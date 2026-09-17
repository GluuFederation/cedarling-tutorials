import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { loadConsoleConfig } from "./config.ts";
import { createConsoleApp } from "./console-app.ts";
import { listen, shutdown } from "./runtime.ts";

if (existsSync(resolve(".env"))) loadEnvFile(resolve(".env"));
const config = loadConsoleConfig();
const app = await createConsoleApp(config);
await listen(app, "P10 CedarStock", config.host, config.port, config.baseUrl);
shutdown(app);
