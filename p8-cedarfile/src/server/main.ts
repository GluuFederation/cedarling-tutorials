import { createServer } from "node:http";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { AppDatabase, databasePath } from "./database.ts";
import { createOidcRuntime } from "./oidc.ts";
import { FileService } from "./service.ts";
import { SafeStorage } from "./storage.ts";

console.info("P8 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
const storage = new SafeStorage(config.dataRoot);
const database = new AppDatabase(
  databasePath(config.dataRoot),
  config.issuer,
  storage,
);
const service = new FileService(database.resources, storage);
service.retryCleanup();
const oidc = await createOidcRuntime(config);
const app = await buildApp({
  config,
  sessions: database.sessions,
  service,
  oidc,
});
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`P8 CedarFile listening at ${config.baseUrl}`);
});

let stopping = false;
function stop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping P8 CedarFile`);
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
