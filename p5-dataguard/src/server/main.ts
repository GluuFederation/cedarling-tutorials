import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { AppDatabase } from "./database.ts";
import { ExportService } from "./export-service.ts";
import { createOidcRuntime } from "./oidc.ts";

console.info("P5 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
const directory = path.dirname(fileURLToPath(import.meta.url));
const database = new AppDatabase(
  path.join(config.dataDirectory, "p5.sqlite"),
  config.issuer,
  path.join(config.dataDirectory, "exports"),
);
const exports = new ExportService(database);
const oidc = await createOidcRuntime(config);
const app = buildApp({
  config,
  database,
  oidc,
  exports,
  webRoot: path.resolve(directory, "../../dist/web"),
});
const server = serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
});
console.log(`P5 DataGuard listening at ${config.baseUrl}`);

let stopping = false;
function shutDown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping P5 DataGuard`);
  server.close(() => {
    database.close();
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
