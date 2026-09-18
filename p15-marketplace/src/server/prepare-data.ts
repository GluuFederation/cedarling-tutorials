import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./database.ts";
import { assertRegularFile, assertStatePaths } from "./files.ts";
import { randomToken } from "./security.ts";

export function openState(dataDir: string) {
  assertStatePaths(dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dataDir, 0o700);
  const keyPath = join(dataDir, "session-key");
  if (!assertRegularFile(keyPath))
    writeFileSync(keyPath, `${randomToken()}\n`, { flag: "wx", mode: 0o600 });
  const keyText = readFileSync(keyPath, "utf8");
  if (!/^[a-f0-9]{64}\n?$/.test(keyText))
    throw new Error("Invalid private state; refusing replacement");
  if (process.platform !== "win32") chmodSync(keyPath, 0o600);
  const databasePath = join(dataDir, "market.sqlite");
  const store = new Store(databasePath);
  try {
    if (process.platform !== "win32") chmodSync(databasePath, 0o600);
    return { key: Buffer.from(keyText.trim(), "hex"), store };
  } catch (error) {
    store.close();
    throw error;
  }
}

export function prepareData(dataDir: string) {
  openState(dataDir).store.close();
}
