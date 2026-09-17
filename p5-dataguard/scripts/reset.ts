import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const config = loadConfig();
rmSync(config.dataDirectory, { force: true, recursive: true });
prepareDataDirectory(config.dataDirectory);
new AppDatabase(
  resolve(config.dataDirectory, "p5.sqlite"),
  config.issuer,
  resolve(config.dataDirectory, "exports"),
).close();
console.info("P5 database, sessions, transactions, and exports restored");
