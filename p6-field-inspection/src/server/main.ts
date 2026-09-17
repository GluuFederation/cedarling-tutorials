import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createApp } from "./app.ts";
import { fakeAuthorization } from "./authorization.ts";
import { loadConfig, prepareDataDirectory } from "./config.ts";
import { AppDatabase } from "./database.ts";
import { createOidc } from "./oidc.ts";

if (existsSync(resolve(".env"))) loadEnvFile(resolve(".env"));

console.info(
  "P6 baseline: FAKE ALLOW marks authorization boundaries; Cedarling is not called.",
);
const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
const database = new AppDatabase(
  resolve(config.dataDirectory, "inspection.sqlite"),
  config.issuer,
);
const oidc = await createOidc(config);
const app = await createApp({
  config,
  database,
  oidc,
  authorization: fakeAuthorization(),
});

const stop = async (signal: string) => {
  console.info(`Received ${signal}; stopping P6 CedarInspect`);
  await app.close();
  database.close();
};
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  console.info(`P6 CedarInspect listening at ${config.baseUrl}`);
} catch (error) {
  database.close();
  console.error("P6 listener unavailable; check its configured loopback port.");
  throw error;
}
