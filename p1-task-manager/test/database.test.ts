import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/database.js";

const directories: string[] = [];
function database() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p1-database-"));
  directories.push(directory);
  return new AppDatabase(
    path.join(directory, "test.sqlite"),
    "http://localhost:18001",
  );
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("task persistence boundaries", () => {
  it("keeps the normal task list tenant scoped", () => {
    const db = database();
    expect(db.listTasks("tenant-b").map(({ id }) => id)).toEqual([
      "task-b-notes",
    ]);
    db.close();
  });

  it("returns a task by direct identifier regardless of list scope", () => {
    const db = database();
    expect(db.getTask("task-a-brief")?.tenantId).toBe("tenant-a");
    db.close();
  });

  it("rejects stale writes even before authorization is introduced", () => {
    const db = database();
    const task = db.getTask("task-a-brief")!;
    expect(
      db.editTask(task.id, task.version, "Updated", task.description),
    ).not.toBe("conflict");
    expect(db.editTask(task.id, task.version, "Stale", task.description)).toBe(
      "conflict",
    );
    db.close();
  });
});

it("preserves deleted fixtures and edited tasks across restarts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p1-restart-"));
  directories.push(directory);
  const filename = path.join(directory, "p1.sqlite");
  let db = new AppDatabase(filename, "http://localhost:18001");
  try {
    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run("task-a-brief");
    db.raw
      .prepare("UPDATE tasks SET title = ?, version = version + 1 WHERE id = ?")
      .run("Edited locally", "task-a-review");
    const before = db.raw.prepare("SELECT * FROM tasks ORDER BY id").all();
    db.close();
    db = new AppDatabase(filename, "http://localhost:18001");
    expect(db.raw.prepare("SELECT * FROM tasks ORDER BY id").all()).toEqual(
      before,
    );
  } finally {
    db.close();
  }
});
