import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig, prepareDataDirectory } from "./config.ts";
import { Database } from "./database.ts";
import { createOidc } from "./oidc.ts";

console.info("P12 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
prepareDataDirectory(config.dataDir);
const database = new Database(resolve(config.dataDir, "hr.sqlite"));
const oidc = await createOidc(config);
const server = createApp(config, database, oidc).listen(
  config.port,
  config.host,
);
server.once("listening", () =>
  console.info(`P12 CedarHR listening at ${config.baseUrl}`),
);
server.once("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `P12 port ${config.port} is already in use; leave the existing service running and choose another port.`
      : "P12 listener failed.",
  );
  database.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    console.info(`Received ${signal}; stopping P12 CedarHR`);
    server.close(() => {
      database.close();
    });
    server.closeIdleConnections();
  });
