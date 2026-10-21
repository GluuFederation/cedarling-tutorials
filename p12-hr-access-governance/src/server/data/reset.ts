import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, prepareDataDirectory } from "../config/environment.ts";
import { Database } from "./database.ts";

const config = loadConfig();
prepareDataDirectory(config.dataDir);
const path = resolve(config.dataDir, "hr.sqlite");
for (const suffix of ["", "-wal", "-shm", "-journal"])
  rmSync(path + suffix, { force: true });
new Database(path).close();
console.info("P12 application data reset; IdP credentials preserved.");
