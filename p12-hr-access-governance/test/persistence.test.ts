import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
import { expect, it } from "vitest";
import { Database } from "../src/server/data/database.ts";
import { HrService } from "../src/server/hr/service.ts";
import { contactRequest } from "./support.ts";

it("preserves removed records when reopening the database", () => {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "p12-hr-access-governance-"),
  );
  const path = join(root, "test.sqlite");
  try {
    const first = new Database(path);
    try {
      expect(
        first.sql
          .prepare("SELECT 1 FROM employees WHERE id = 'other-team'")
          .get(),
      ).toBeDefined();
      first.sql.exec("DELETE FROM employees WHERE id = 'other-team'");
    } finally {
      first.close();
    }
    const reopened = new Database(path);
    try {
      expect(
        reopened.sql
          .prepare("SELECT 1 FROM employees WHERE id = 'other-team'")
          .get(),
      ).toBeUndefined();
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses an incompatible schema without changing employee or grant data", () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "p12-schema-"));
  const path = join(directory, "test.sqlite");
  const first = new Database(path);
  const before = first.sql
    .prepare("SELECT * FROM employees WHERE id='cora'")
    .get();
  first.sql.pragma("user_version = 1");
  first.close();
  try {
    expect(() => new Database(path)).toThrow(/explicitly run pnpm reset/);
    const raw = new Sqlite(path);
    expect(
      raw.prepare("SELECT * FROM employees WHERE id='cora'").get(),
    ).toEqual(before);
    expect(raw.pragma("user_version", { simple: true })).toBe(1);
    raw.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("preserves approved grant dates and medical records after restart", async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "p12-reopen-"));
  const path = join(directory, "test.sqlite");
  const first = new Database(path);
  const service = new HrService(first, async () => {});
  const request = await service.request("lin", contactRequest());
  const grant = await service.transition("nia", request.id, 1, "approve");
  const medical = await service.medical("aya", "cora");
  first.close();
  const reopened = new Database(path);
  try {
    const row = reopened.grant(grant.id);
    if (!row) throw new Error("Missing persisted grant");
    expect(reopened.grantView(row)).toEqual(grant);
    expect(
      await new HrService(reopened, async () => {}).medical("aya", "cora"),
    ).toEqual(medical);
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
