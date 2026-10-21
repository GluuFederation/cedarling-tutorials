import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/server/database.ts";

it("preserves removed records when reopening the database", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "p15-marketplace-"));
  const path = join(root, "test.sqlite");
  try {
    const first = new Store(path);
    try {
      expect(
        first.db.prepare("SELECT 1 FROM support_assignments").get(),
      ).toBeDefined();
      first.db.exec("DELETE FROM support_assignments");
    } finally {
      first.close();
    }
    const reopened = new Store(path);
    try {
      expect(
        reopened.db.prepare("SELECT 1 FROM support_assignments").get(),
      ).toBeUndefined();
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
