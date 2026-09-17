import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";

const config = loadConfig();
const root = path.resolve(config.dataRoot);
const expected = path.resolve(".local/p9-data");
if (root !== expected) throw new Error("Reset is limited to .local/p9-data");
if (existsSync(root)) {
  const stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(root) !== root
  ) {
    throw new Error("Reset rejected an unexpected data root");
  }
  rmSync(root, { recursive: true });
}
const database = new AppDatabase(databasePath(root), config.issuer);
database.close();
console.log("P9 local data reset to deterministic fixtures");
