import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import { SafeStorage } from "../src/server/storage.ts";

process.loadEnvFile(path.resolve(process.cwd(), ".env"));
const config = loadConfig();
const expected = path.resolve(process.cwd(), ".local", "p8-data");
if (config.dataRoot !== expected) {
  throw new Error("Reset accepts only the project-owned .local/p8-data target");
}
if (existsSync(expected)) {
  const stat = lstatSync(expected);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(expected) !== expected
  ) {
    throw new Error("Reset rejected an unexpected data-root type");
  }
  rmSync(expected, { recursive: true });
}
mkdirSync(expected, { recursive: true, mode: 0o700 });
const storage = new SafeStorage(expected);
const database = new AppDatabase(
  databasePath(expected),
  config.issuer,
  storage,
);
database.close();
console.log("P8 deterministic workspace reset");
