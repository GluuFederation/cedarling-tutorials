import { createServer } from "node:http";
import { buildApp } from "./app.ts";
import { AuthorizationGateway } from "./authorization.ts";
import { loadConfig } from "./config.ts";
import { AppDatabase, databasePath } from "./database.ts";
import { createOidcRuntime } from "./oidc.ts";
import { attachRealtime } from "./realtime.ts";
import { SessionStore } from "./session-store.ts";

console.info("P9 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
const database = new AppDatabase(databasePath(config.dataRoot), config.issuer);
const sessions = new SessionStore(database.connection);
const authorization = new AuthorizationGateway();
const oidc = await createOidcRuntime(config);
const { app } = await buildApp({
  config,
  sessions,
  chat: database.chat,
  oidc,
  authorization,
});
const server = createServer(app);
const realtime = attachRealtime(server, {
  config,
  sessions,
  chat: database.chat,
  authorization,
});

server.listen(config.port, config.host, () => {
  console.log(`P9 CedarRealtime listening at ${config.baseUrl}`);
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; stopping P9 CedarRealtime`);
  await realtime.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
