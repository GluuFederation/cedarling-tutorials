import { writeSync } from "node:fs";
import { createApp } from "./app.js";
import { loadConfig } from "./config/project-config.js";
import { loadProjectEnvironment } from "./config/environment.js";
import { createRuntime } from "./runtime.js";

loadProjectEnvironment();

const config = loadConfig();
const runtime = await createRuntime(config);
const app = createApp(runtime);

await app.listen({ host: config.host, port: config.port });
console.log(`P2 TenantRAG listening at ${config.baseUrl}`);

let stopping = false;

async function shutDown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  // Finish before the development supervisor's five-second shutdown limit.
  const deadline = setTimeout(() => {
    writeSync(2, "P2 shutdown timed out\n");
    process.exit(1);
  }, 4_000);
  console.log(`Received ${signal}; stopping P2 TenantRAG`);
  let exitCode = 0;
  try {
    await app.close();
  } catch {
    console.error("P2 shutdown failed");
    exitCode = 1;
  }
  try {
    await Promise.all(
      [process.stdout, process.stderr].map(
        (stream) =>
          new Promise<void>((resolve, reject) => {
            stream.write("", (error) => {
              if (error) reject(error);
              else resolve();
            });
          }),
      ),
    );
  } catch {
    exitCode = 1;
  }
  clearTimeout(deadline);
  // The executable exits after cleanup; reusable authorization code only closes resources.
  process.exit(exitCode);
}
process.on("SIGINT", () => void shutDown("SIGINT"));
process.on("SIGTERM", () => void shutDown("SIGTERM"));
