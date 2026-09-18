import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase, DomainError } from "../src/server/database.ts";

const directories: string[] = [];
const databases: AppDatabase[] = [];
const checklist = {
  safetyGuardSecured: true,
  fluidLevelChecked: true,
  operatingTemperatureRecorded: true,
} as const;

function database(): AppDatabase {
  const directory = mkdtempSync(resolve(tmpdir(), "p6-database-"));
  directories.push(directory);
  const instance = new AppDatabase(
    resolve(directory, "test.sqlite"),
    "http://idp.localhost:4000",
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
      workOrder: { status: "completed", workOrderVersion: 2 },
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

  it("prevents an assignment race between authorization and commit", () => {
    const db = database();
    db.reassign({
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
