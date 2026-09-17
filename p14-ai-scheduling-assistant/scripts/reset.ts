import { resolve } from "node:path";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
const database = new AppDatabase(
  resolve(config.dataDirectory, "schedule.sqlite"),
  config,
);
database.reset();
database.close();
console.info("P14 scheduling fixtures restored");
