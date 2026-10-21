import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/server/config.ts";
import { assertStatePaths } from "../src/server/files.ts";
import { prepareData } from "../src/server/prepare-data.ts";

const config = loadConfig();
assertStatePaths(config.dataDir);
const path = join(config.dataDir, "market.sqlite");
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(`${path}${suffix}`, { force: true });
}
prepareData(config.dataDir);
console.info("P15 application data reset; IdP credentials preserved");
