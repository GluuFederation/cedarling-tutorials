import { rmSync } from "node:fs";
import { loadConfig, prepareData } from "../config/environment.ts";
import { SchoolDatabase } from "./database.ts";

const config = loadConfig();
const path = prepareData(config);
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(`${path}${suffix}`, { force: true });
}
new SchoolDatabase(path, config.issuer).close();
console.info("P13 application data reset; IdP credentials preserved");
