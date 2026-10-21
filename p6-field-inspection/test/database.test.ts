import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Sqlite from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase, DomainError } from "../src/server/database.ts";

const directories: string[] = [];
const databases: AppDatabase[] = [];
const checklist = {
  equipmentConditionPassed: true,
  safetyChecksPassed: true,
  functionalCheckPassed: true,
} as const;

function database(): AppDatabase {
  const directory = mkdtempSync(resolve(tmpdir(), "p6-database-"));
  directories.push(directory);
  const instance = new AppDatabase(
    resolve(directory, "test.sqlite"),
    "http://localhost:18006",
  );
  databases.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of databases.splice(0)) instance.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("field inspection repository", () => {
  it("requires an explicit reset for incompatible saved inspections", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "p6-legacy-"));
    directories.push(directory);
    const path = resolve(directory, "test.sqlite");
    const legacy = new Sqlite(path);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, UNIQUE (issuer, subject));
      INSERT INTO users VALUES ('user-elena', 'http://localhost:18006', 'elena', 'Elena Rossi', 'technician');
      CREATE TABLE work_orders (id TEXT PRIMARY KEY, equipment TEXT NOT NULL, site TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'completed')), work_order_version INTEGER NOT NULL);
      INSERT INTO work_orders VALUES ('wo-legacy', 'Legacy pump', 'North Plant', 'completed', 2);
      CREATE TABLE assignments (work_order_id TEXT PRIMARY KEY REFERENCES work_orders(id), technician_id TEXT NOT NULL REFERENCES users(id), assignment_epoch INTEGER NOT NULL);
      INSERT INTO assignments VALUES ('wo-legacy', 'user-elena', 1);
      CREATE TABLE inspections (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL UNIQUE REFERENCES work_orders(id), submitted_by TEXT NOT NULL REFERENCES users(id), checklist_json TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO inspections VALUES ('inspection_old', 'wo-legacy', 'user-elena', '{"safetyGuardSecured":true,"fluidLevelChecked":false,"operatingTemperatureRecorded":true}', 'Preserve this record.', '2026-09-01T00:00:00Z');
    `);
    legacy.close();
    expect(() => new AppDatabase(path, "http://localhost:18006")).toThrow(
      "pnpm reset",
    );
    const preserved = new Sqlite(path);
    expect(preserved.prepare("SELECT notes FROM inspections").get()).toEqual({
      notes: "Preserve this record.",
    });
    preserved.close();
    const fresh = new AppDatabase(path, "http://localhost:18006", {
      reset: true,
    });
    databases.push(fresh);
    expect(fresh.inspectionCount()).toBe(0);
    expect(fresh.listWorkOrders()).toHaveLength(6);
  });
  it("seeds six independently versioned work orders", () => {
    const db = database();
    expect(db.listWorkOrders()).toHaveLength(6);
    expect(db.listWorkOrders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wo-generator-04",
          assigneeId: "user-malik",
          assignmentEpoch: 1,
          workOrderVersion: 1,
        }),
        expect.objectContaining({
          id: "wo-pump-17",
          assigneeId: "user-elena",
          assignmentEpoch: 1,
          workOrderVersion: 1,
        }),
      ]),
    );
  });

  it("records only committed assignment changes with the actor and a bounded history", () => {
    const db = database();
    const initial = {
      principalId: "user-rowan",
      workOrderId: "wo-pump-17",
      technicianId: "user-elena",
      expectedAssignmentEpoch: 1,
    };
    expect(db.reassign(initial).assignmentEpoch).toBe(1);
    expect(db.assignmentHistory(initial.workOrderId)).toEqual([]);
    for (let epoch = 1; epoch <= 22; epoch++) {
      db.reassign({
        ...initial,
        technicianId: epoch % 2 ? "user-malik" : "user-elena",
        expectedAssignmentEpoch: epoch,
      });
    }
    const history = db.assignmentHistory(initial.workOrderId);
    expect(history).toHaveLength(20);
    expect(history[0]).toMatchObject({
      previousAssignee: "Malik Johnson",
      newAssignee: "Elena Rossi",
      changedBy: "Rowan Lee",
      assignmentEpoch: 23,
    });
    expect(Number.isNaN(Date.parse(history[0]?.changedAt ?? ""))).toBe(false);
    expect(history[19]?.assignmentEpoch).toBe(4);
    expect(() =>
      db.reassign({ ...initial, technicianId: "user-malik" }),
    ).toThrow("state_conflict");
    // The history insert and assignment update form one transaction.
    expect(() =>
      db.reassign({
        ...initial,
        principalId: "missing-actor",
        technicianId: "user-malik",
        expectedAssignmentEpoch: 23,
      }),
    ).toThrow();
    expect(db.findWorkOrder(initial.workOrderId)?.assignmentEpoch).toBe(23);
    expect(db.assignmentHistory(initial.workOrderId)).toEqual(history);
    db.reset("http://localhost:18006");
    expect(db.assignmentHistory(initial.workOrderId)).toEqual([]);
  });

  it("creates and conditionally deletes an open work order", () => {
    const db = database();
    const created = db.createWorkOrder({
      equipment: "Hydraulic press 05",
      site: "Machine Hall",
      technicianId: "user-elena",
    });
    expect(created).toMatchObject({
      equipment: "Hydraulic press 05",
      assigneeId: "user-elena",
      assignmentEpoch: 1,
      workOrderVersion: 1,
      status: "open",
    });
    expect(() =>
      db.deleteWorkOrder({
        workOrderId: created.id,
        expectedAssignmentEpoch: 2,
        expectedWorkOrderVersion: 1,
      }),
    ).toThrowError(new DomainError("state_conflict", 409));
    db.deleteWorkOrder({
      workOrderId: created.id,
      expectedAssignmentEpoch: 1,
      expectedWorkOrderVersion: 1,
    });
    expect(db.findWorkOrder(created.id)).toBeUndefined();
  });

  it("increments only the assignment epoch during reassignment", () => {
    const db = database();
    const reassigned = db.reassign({
      principalId: "user-rowan",
      workOrderId: "wo-pump-17",
      technicianId: "user-malik",
      expectedAssignmentEpoch: 1,
    });
    expect(reassigned).toMatchObject({
      assigneeId: "user-malik",
      assignmentEpoch: 2,
      workOrderVersion: 1,
      status: "open",
    });
    expect(() =>
      db.reassign({
        principalId: "user-rowan",
        workOrderId: "wo-pump-17",
        technicianId: "user-elena",
        expectedAssignmentEpoch: 1,
      }),
    ).toThrowError(new DomainError("state_conflict", 409));
  });

  it("stores one inspection and safely replays the same idempotent command", () => {
    const db = database();
    const command = {
      principalId: "user-elena",
      workOrderId: "wo-pump-17",
      capturedAssignmentEpoch: 1,
      idempotencyKey: randomUUID(),
      expectedWorkOrderVersion: 1,
      checklist,
      notes: "Pump inspected.",
    };
    const first = db.submit(command);
    const replay = db.submit(command);
    expect(first).toMatchObject({
      replayed: false,
      workOrder: { status: "awaiting_review", workOrderVersion: 2 },
    });
    expect(replay).toMatchObject({
      replayed: true,
      inspection: { id: first.inspection.id },
    });
    expect(db.inspectionCount()).toBe(1);
    expect(() => db.submit({ ...command, notes: "Changed" })).toThrowError(
      new DomainError("idempotency_conflict", 409),
    );
  });

  it("requires corrections for failed checks, then reviews a new submission", () => {
    const db = database();
    const command = {
      principalId: "user-elena",
      workOrderId: "wo-pump-17",
      capturedAssignmentEpoch: 1,
      idempotencyKey: randomUUID(),
      expectedWorkOrderVersion: 1,
      checklist: { ...checklist, equipmentConditionPassed: false },
      notes: "Guard mounting is loose.",
    };
    const submitted = db.submit(command);
    const review = {
      principalId: "user-rowan",
      workOrderId: command.workOrderId,
      inspectionId: submitted.inspection.id,
      expectedWorkOrderVersion: 2,
      idempotencyKey: randomUUID(),
      outcome: "complete" as const,
      notes: "",
    };
    expect(() => db.review(review)).toThrowError(
      new DomainError("corrections_required", 409),
    );
    const corrections = {
      ...review,
      outcome: "request_corrections" as const,
      notes: "Secure the guard and inspect again.",
    };
    expect(db.review(corrections).workOrder.status).toBe("changes_requested");
    expect(db.review(corrections).replayed).toBe(true);
    const corrected = db.submit({
      ...command,
      idempotencyKey: randomUUID(),
      expectedWorkOrderVersion: 3,
      checklist,
      notes: "Guard secured and rechecked.",
    });
    expect(() =>
      db.review({
        ...review,
        idempotencyKey: randomUUID(),
        inspectionId: corrected.inspection.id,
      }),
    ).toThrowError(new DomainError("state_conflict", 409));
    expect(
      db.review({
        ...review,
        inspectionId: corrected.inspection.id,
        expectedWorkOrderVersion: 4,
        idempotencyKey: randomUUID(),
      }).workOrder.status,
    ).toBe("completed");
    expect(db.inspections(command.workOrderId)).toHaveLength(2);
    expect(db.inspections(command.workOrderId)[0]?.review?.outcome).toBe(
      "complete",
    );
    expect(() =>
      db.submit({
        ...command,
        idempotencyKey: randomUUID(),
        expectedWorkOrderVersion: 5,
      }),
    ).toThrowError(new DomainError("state_conflict", 409));
  });

  it("rejects unanswered checklist items and failures without notes", () => {
    const db = database();
    const command = {
      principalId: "user-elena",
      workOrderId: "wo-pump-17",
      capturedAssignmentEpoch: 1,
      idempotencyKey: randomUUID(),
      expectedWorkOrderVersion: 1,
      checklist,
      notes: "",
    };
    expect(() =>
      db.submit({
        ...command,
        checklist: { ...checklist, equipmentConditionPassed: null } as never,
      }),
    ).toThrowError(new DomainError("invalid_checklist", 400));
    expect(() =>
      db.submit({
        ...command,
        checklist: { ...checklist, equipmentConditionPassed: false },
      }),
    ).toThrowError(new DomainError("failure_notes_required", 400));
    expect(db.inspectionCount()).toBe(0);
  });

  it("prevents an assignment race between authorization and commit", () => {
    const db = database();
    db.reassign({
      principalId: "user-rowan",
      workOrderId: "wo-pump-17",
      technicianId: "user-malik",
      expectedAssignmentEpoch: 1,
    });
    expect(() =>
      db.submit({
        principalId: "user-elena",
        workOrderId: "wo-pump-17",
        capturedAssignmentEpoch: 1,
        idempotencyKey: randomUUID(),
        expectedWorkOrderVersion: 1,
        checklist,
        notes: "Stale authorization window.",
      }),
    ).toThrowError(new DomainError("state_conflict", 409));
    expect(db.inspectionCount()).toBe(0);
  });
});
