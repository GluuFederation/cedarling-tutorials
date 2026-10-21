import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Sqlite from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { SchoolDatabase } from "../src/server/data/database.ts";

it("closes the database when initialization fails before schema loading", () => {
  let opened: Sqlite.Database | undefined;
  const failure = new Error("pragma failed");
  const pragma = vi
    .spyOn(Sqlite.prototype, "pragma")
    .mockImplementationOnce(function (this: Sqlite.Database) {
      opened = this;
      throw failure;
    });
  try {
    expect(
      () => new SchoolDatabase(":memory:", "http://localhost:18013"),
    ).toThrow(failure);
    expect(opened?.open).toBe(false);
  } finally {
    pragma.mockRestore();
    if (opened?.open) opened.close();
  }
});

it("preserves removed records when reopening the database", () => {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "p13-student-records-"),
  );
  const path = join(root, "test.sqlite");
  try {
    const first = new SchoolDatabase(path, "http://localhost:18013");
    try {
      expect(
        first.sql
          .prepare("SELECT 1 FROM grades WHERE id = 'grade-sam-2'")
          .get(),
      ).toBeDefined();
      first.sql.exec("DELETE FROM grades WHERE id = 'grade-sam-2'");
    } finally {
      first.close();
    }
    const reopened = new SchoolDatabase(path, "http://localhost:18013");
    try {
      expect(
        reopened.sql
          .prepare("SELECT 1 FROM grades WHERE id = 'grade-sam-2'")
          .get(),
      ).toBeUndefined();
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses an incompatible schema without deleting or reseeding records", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "p13-schema-"));
  const path = join(root, "school.sqlite");
  const first = new SchoolDatabase(path, "http://localhost:18013");
  const row = first.snapshot("talia", "grade-sam-1")?.grade;
  first.sql.pragma("user_version = 1");
  first.close();
  try {
    expect(() => new SchoolDatabase(path, "http://localhost:18013")).toThrow(
      /explicitly run pnpm reset/,
    );
    const raw = new Sqlite(path);
    try {
      expect(raw.pragma("user_version", { simple: true })).toBe(1);
      expect(
        raw
          .prepare(
            "SELECT score,internal_note FROM grades WHERE id='grade-sam-1'",
          )
          .get(),
      ).toEqual({ score: row?.score, internal_note: row?.internalNote });
    } finally {
      raw.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
