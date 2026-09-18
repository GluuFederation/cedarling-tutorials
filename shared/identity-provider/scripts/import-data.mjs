import { cpSync, lstatSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.env.IMPORT_SOURCE ?? "/import");
const destination = resolve(process.env.IMPORT_DESTINATION ?? "/app-config");
function entries(directory) {
  return readdirSync(directory, { withFileTypes: true }).filter(
    ({ name }) => name !== ".DS_Store",
  );
}
if (entries(destination).length)
  throw new Error("Destination volume is not empty; refusing import");
function validate(directory) {
  for (const entry of entries(directory)) {
    const path = resolve(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink() || (!status.isDirectory() && !status.isFile()))
      throw new Error("Import accepts only regular files and directories");
    if (status.isFile() && status.nlink !== 1)
      throw new Error("Import rejects linked files");
    if (
      entry.name.endsWith("-wal") ||
      entry.name.endsWith("-shm") ||
      entry.name.endsWith("-journal")
    )
      throw new Error(
        "Stop the old application cleanly before importing SQLite state",
      );
    if (status.isDirectory()) validate(path);
  }
}
validate(source);
for (const entry of entries(source))
  cpSync(resolve(source, entry.name), resolve(destination, entry.name), {
    recursive: true,
    errorOnExist: true,
    preserveTimestamps: true,
  });
console.info("Offline learner data imported; source files were not changed.");
