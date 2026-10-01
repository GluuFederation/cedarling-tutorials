/** Check native startup prerequisites without spending provider quota. */
import { access } from "node:fs/promises";
import { loadProjectEnvironment } from "../src/config/environment.js";
import { loadConfig } from "../src/config/project-config.js";

loadProjectEnvironment();
const config = loadConfig();
try {
  await access(config.artifactPath);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  throw new Error(
    "P2 corpus is missing; configure provider keys and run pnpm run setup once before pnpm dev (setup consumes provider quota)",
    { cause: error },
  );
}
