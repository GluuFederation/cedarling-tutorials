import { existsSync, writeSync } from "node:fs";
import path from "node:path";
import { loadProjectEnvironment } from "./environment.js";
import { buildApp } from "./app.js";
import { createServerAuthorization } from "./authorization-trace.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./database.js";
import { createOidcRuntime } from "./oidc.js";

loadProjectEnvironment();

const projectRoot = process.env.P1_PROJECT_ROOT || process.cwd();
const webRoot = path.resolve(projectRoot, "dist/web");
if (!existsSync(path.join(webRoot, "index.html")))
  throw new Error(
    "P1 web bundle is missing; run pnpm build before starting P1",
  );
const config = loadConfig(process.env, projectRoot);
const oidc = await createOidcRuntime(config);
const authorization = await createServerAuthorization({
  projectRoot,
  dataDirectory: config.dataDirectory,
});
console.info(
  `P1 Cedarling policy ${authorization.policy.release} | sha256 ${authorization.policy.sha256}`,
);
const database = new AppDatabase(
  path.join(config.dataDirectory, "p1.sqlite"),
  config.issuer,
);
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  app = await buildApp({
    config,
    database,
    oidc,
    authorization,
    webRoot,
  });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (app) await app.close();
  else {
    await authorization.close();
    database.close();
  }
  throw error;
}
console.log(`P1 Task Manager listening at ${config.baseUrl}`);

let stopping = false;

async function shutDown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  // Finish before the development supervisor's five-second shutdown limit.
  const deadline = setTimeout(() => {
    writeSync(2, "P1 shutdown timed out\n");
    process.exit(1);
  }, 4_000);
  console.log(`Received ${signal}; stopping P1 Task Manager`);
  let exitCode = 0;
  try {
    await app?.close();
  } catch {
    console.error("P1 shutdown failed");
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
  // The pinned WASM runtime can retain timers after shutDown() resolves.
  // Only this executable exits; reusable authorization code just closes resources.
  process.exit(exitCode);
}
process.on("SIGINT", () => void shutDown("SIGINT"));
process.on("SIGTERM", () => void shutDown("SIGTERM"));
