import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { initializeDatabase } from "../src/server/database-fixtures.ts";
import { SafeStorage } from "../src/server/storage.ts";
import { temporaryRoot } from "./temporary-root.ts";

it("does not restore deleted shares, records, or content on startup", () => {
  const root = temporaryRoot("p8-persistence-");
  const database = new Database(":memory:");
  const storage = new SafeStorage(root);
  try {
    initializeDatabase(database, "http://localhost:18008", storage);
    database.exec("DELETE FROM shares WHERE user_id = 'user-priya'");
    database.exec("DELETE FROM resources WHERE id = 'res_01K3PRIVATEA'");
    storage.removeNew("res_01K3PRIVATEA");
    storage.removeNew("res_01K3NOTESAAA");
    initializeDatabase(database, "http://localhost:18008", storage);
    expect(
      database
        .prepare("SELECT 1 FROM shares WHERE user_id = 'user-priya'")
        .get(),
    ).toBeUndefined();
    expect(
      database
        .prepare("SELECT 1 FROM resources WHERE id = 'res_01K3PRIVATEA'")
        .get(),
    ).toBeUndefined();
    expect(storage.has("res_01K3PRIVATEA")).toBe(false);
    expect(storage.has("res_01K3NOTESAAA")).toBe(false);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
