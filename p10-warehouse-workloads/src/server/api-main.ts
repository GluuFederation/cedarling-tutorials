import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createApiApp } from "./api-app.ts";
import { fakeAuthorization } from "./authorization.ts";
import { loadApiConfig, prepareDataDirectory } from "./config.ts";
import { WarehouseDatabase } from "./database.ts";
import { createTokenVerifier } from "./jwt.ts";
import { listen, shutdown } from "./runtime.ts";

if (existsSync(resolve(".env"))) loadEnvFile(resolve(".env"));
console.info(
  "P10 baseline: FAKE ALLOW marks authorization boundaries; Cedarling is not called.",
);
const config = loadApiConfig();
prepareDataDirectory(config.dataDirectory);
const database = new WarehouseDatabase(
  resolve(config.dataDirectory, "warehouse.sqlite"),
);
const app = await createApiApp({
  database,
  verifier: await createTokenVerifier(config),
  authorization: fakeAuthorization(),
});
await listen(app, "P10 Warehouse API", config.host, config.port);
shutdown(app, () => database.close());
