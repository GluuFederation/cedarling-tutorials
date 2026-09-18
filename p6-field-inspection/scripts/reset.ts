import { resolve } from "node:path";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
const database = new AppDatabase(
  resolve(config.dataDirectory, "inspection.sqlite"),
  config.issuer,
);
database.reset(config.issuer);
database.close();
console.info("P6 field-inspection fixtures restored");
