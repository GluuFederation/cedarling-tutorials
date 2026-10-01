import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { buildApp } from "./app.ts";
import {
  createDataAuthorization,
  type DataAuthorization,
} from "./authorization.ts";
import { loadConfig } from "./config.ts";
import { AppDatabase } from "./database.ts";
import { ExportService } from "./export-service.ts";
import { createOidcRuntime } from "./oidc.ts";

const config = loadConfig();
const directory = path.dirname(fileURLToPath(import.meta.url));
const database = new AppDatabase(
  path.join(config.dataDirectory, "p5.sqlite"),
  config.issuer,
  path.join(config.dataDirectory, "exports"),
);
let authorization: DataAuthorization | undefined;
async function close(): Promise<void> {
  try {
    await authorization?.close();
  } finally {
    database.close();
  }
}

try {
  authorization = await createDataAuthorization();
  database.cleanupExports();
  const exports = new ExportService(database);
  const oidc = await createOidcRuntime(config);
  const app = buildApp({
    config,
    database,
    oidc,
    exports,
    authorization,
    webRoot: path.resolve(directory, "../../dist/web"),
  });
  const server = serve(
    {
      hostname: config.host,
      port: config.port,
      fetch: app.fetch,
    },
    () => console.log(`P5 DataGuard listening at ${config.baseUrl}`),
  );

  let stopping = false;
  function shutDown(reason: string): void {
    if (stopping) return;
    stopping = true;
    console.info(`Stopping P5 DataGuard: ${reason}`);
    server.close(() => {
      void close()
        .catch(() => {
          console.error("P5 shutdown failed");
          process.exitCode = 1;
        })
        .finally(() => process.exit(process.exitCode ?? 0));
    });
  }
  server.on("error", () => {
    process.exitCode = 1;
    shutDown("listener unavailable");
  });
  process.once("SIGINT", () => shutDown("SIGINT"));
  process.once("SIGTERM", () => shutDown("SIGTERM"));
} catch (error) {
  await close();
  throw error;
}
