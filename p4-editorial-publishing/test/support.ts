import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../src/server/database.ts";
import type { Session } from "../src/server/models.ts";

export function fixture(subject = "riley") {
  const directory = mkdtempSync(join(tmpdir(), "p4-test-"));
  const database = new AppDatabase(directory, "http://localhost:18004");
  const principal = database.principal("http://localhost:18004", subject);
  if (!principal) throw new Error(`Missing test principal ${subject}`);
  const session: Session = {
    csrfToken: "test-csrf",
    principal,
  };
  return {
    database,
    directory,
    session,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function form(values: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values))
    data.set(name, String(value));
  return data;
}

export function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture record");
  return value;
}
