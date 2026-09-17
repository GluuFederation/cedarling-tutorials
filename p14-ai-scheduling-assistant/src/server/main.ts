import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { fakeAuthorization } from "./authorization.ts";
import { loadConfig, prepareDataDirectory } from "./config.ts";
import { AppDatabase } from "./database.ts";
import { createOidc } from "./oidc.ts";
import { SchedulingService } from "./service.ts";

const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
const database = new AppDatabase(
  resolve(config.dataDirectory, "schedule.sqlite"),
  config,
);
const authorization = fakeAuthorization();
const service = new SchedulingService(database, authorization);

console.info(
  "P14 baseline: FAKE ALLOW marks authorization boundaries; Cedarling is not called.",
);
const app = await createApp({
  config,
  database,
  oidc: await createOidc(config),
  service,
});

await app.listen({ host: config.host, port: config.port });
console.info(`P14 CedarSchedule listening at ${config.baseUrl}`);

const stop = async (signal: string) => {
  console.info(`Received ${signal}; stopping P14 CedarSchedule`);
  await app.close();
  database.close();
};
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
