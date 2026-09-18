import { authPersonaArgument, runAuthCli } from "../src/auth/cli.js";
import { loadConfig } from "../src/config/project-config.js";
import { loadProjectEnvironment } from "../src/config/environment.js";

loadProjectEnvironment();
const config = loadConfig();
await runAuthCli(authPersonaArgument(process.argv.slice(2)), config);
