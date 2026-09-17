import { resolve } from "node:path";
import { loadApiConfig, prepareDataDirectory } from "../src/server/config.ts";
import { WarehouseDatabase } from "../src/server/database.ts";

const config = loadApiConfig();
prepareDataDirectory(config.dataDirectory);
const database = new WarehouseDatabase(
  resolve(config.dataDirectory, "warehouse.sqlite"),
);
database.reset();
database.close();
console.info("P10 warehouse fixtures restored");
