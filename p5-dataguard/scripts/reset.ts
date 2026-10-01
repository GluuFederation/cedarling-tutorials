import { resolve } from "node:path";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";

const config = loadConfig();
const database = new AppDatabase(
  resolve(config.dataDirectory, "p5.sqlite"),
  config.issuer,
  resolve(config.dataDirectory, "exports"),
);
try {
  database.reset(config.issuer);
} finally {
  database.close();
}
console.info("P5 database, sessions, transactions, and exports restored");
