import { existsSync } from "node:fs";
import path from "node:path";
import { loadProjectEnvironment } from "./environment.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppDatabase } from "./database.js";
import { createOidcRuntime } from "./oidc.js";

loadProjectEnvironment();

console.info("P1 authorization: FAKE ALLOW; Cedarling is not called.");

const projectRoot = process.env.P1_PROJECT_ROOT || process.cwd();
const webRoot = path.resolve(projectRoot, "dist/web");
if (!existsSync(path.join(webRoot, "index.html")))
  throw new Error(
    "P1 web bundle is missing; run pnpm build before starting P1",
  );
const config = loadConfig(process.env, projectRoot);
const database = new AppDatabase(
  path.join(config.dataDirectory, "p1.sqlite"),
  config.issuer,
);
const oidc = await createOidcRuntime(config);
const app = await buildApp({
  config,
  database,
  oidc,
  webRoot,
});

await app.listen({ host: config.host, port: config.port });
console.log(`P1 Task Manager listening at ${config.baseUrl}`);

async function shutDown(signal: string): Promise<void> {
  console.log(`Received ${signal}; stopping P1 Task Manager`);
  await app.close();
}
process.once("SIGINT", () => void shutDown("SIGINT"));
process.once("SIGTERM", () => void shutDown("SIGTERM"));
