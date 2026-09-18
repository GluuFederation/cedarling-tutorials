import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionInput } from "../src/server/authorization.ts";
import { fakeAuthorize, unavailable } from "../src/server/authorization.ts";
import { Database } from "../src/server/database.ts";
import { denied } from "../src/server/errors.ts";
import { HrService } from "../src/server/service.ts";

const databases: Database[] = [];
function fixture() {
  const db = new Database(":memory:");
  databases.push(db);
  return { db, service: new HrService(db, fakeAuthorize) };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});
describe("the five capability effects", () => {
  it("traces the current governance grant status instead of labeling it absent", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { db } = fixture();
    const decisions: DecisionInput[] = [];
    const service = new HrService(db, async (input) => {
      decisions.push(input);
      await fakeAuthorize(input);
    });
    const grant = await service.request("lin", "cora", 1);
    await service.transition("lin", grant.id, 1, "approve");
    await service.transition("nia", grant.id, 2, "revoke");
    await service.grant("lin", grant.id, "review");
    expect(
      decisions.map((input) => [
        input.capability,
        input.facts.grant?.status ?? "absent",
      ]),
    ).toEqual([
      ["grant.request", "absent"],
      ["grant.approve", "pending"],
      ["grant.revoke", "approved"],
      ["grant.approve", "revoked"],
    ]);
    expect(
      log.mock.calls.every(([line]) => String(line).includes("FAKE ALLOW")),
    ).toBe(true);
  });
  it("guards empty collections and rechecks earlier candidates after a later asynchronous decision", async () => {
    const { db } = fixture();
    let changed = false;
    const guarded = new HrService(db, async (input) => {
      if (input.resourceId === "other-team" && !changed) {
        db.sql
          .prepare(
            "UPDATE employees SET managerId = 'other-manager', version = version + 1 WHERE id = 'cora'",
          )
          .run();
        changed = true;
      }
      if (
        input.facts.employee &&
        input.facts.employee.managerId !== input.facts.principal.id
      )
        throw denied();
    });
    expect(await guarded.employees("ben")).toEqual([]);
    db.sql.prepare("DELETE FROM employees WHERE tenantId = 'tenant-a'").run();
    await expect(
      new HrService(db, unavailable).employees("ben"),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("allows exactly one effect when duplicate requests overlap", async () => {
    const { service } = fixture();
    const results = await Promise.allSettled([
      service.request("lin", "cora", 1),
      service.request("lin", "cora", 1),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await service.grants("lin", "review")).toHaveLength(1);
  });
  it("keeps grants independent for different employees and their current managers", async () => {
    const { service } = fixture();
    const cora = await service.request("lin", "cora", 1);
    const dee = await service.request("lin", "other-team", 1);
    expect([cora, dee]).toMatchObject([
      { employeeName: "Cora", managerName: "Ben" },
      { employeeName: "Dee", managerName: "Other manager" },
    ]);
  });
  it("treats elapsed grants as expired on reads and expires them transactionally before replacement", async () => {
    const { db, service } = fixture();
    const grant = await service.request("lin", "cora", 1);
    db.sql
      .prepare("UPDATE grants SET expiresAt = ? WHERE id = ?")
      .run(Date.now() - 1, grant.id);
    expect((await service.grant("lin", grant.id, "requests")).status).toBe(
      "expired",
    );
    expect(db.grant(grant.id)?.status).toBe("pending");
    await expect(
      service.transition("nia", grant.id, 1, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    await service.request("lin", "cora", 1);
    expect(db.grant(grant.id)).toMatchObject({ status: "expired", version: 2 });
  });
  it("reauthorizes changed facts and does not release contact data after a concurrent revocation", async () => {
    const { db, service } = fixture();
    const request = await service.request("lin", "cora", 1);
    const grant = await service.transition("nia", request.id, 1, "approve");
    let calls = 0;
    const guarded = new HrService(db, async (input) => {
      calls++;
      if (calls === 1)
        db.sql
          .prepare(
            "UPDATE grants SET status = 'revoked', version = version + 1 WHERE id = ?",
          )
          .run(grant.id);
      else {
        expect(input.facts.effectiveGrant?.status).toBe("revoked");
        throw denied();
      }
    });
    await expect(guarded.contact("ben", "cora")).rejects.toMatchObject({
      status: 403,
    });
    expect(calls).toBe(2);
  });
  it("rolls back failed writes and limits fact-change retries", async () => {
    const { db, service } = fixture();
    db.sql.exec(
      "CREATE TRIGGER fail_request BEFORE INSERT ON grants BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    await expect(service.request("lin", "cora", 1)).rejects.toThrow();
    expect(db.sql.prepare("SELECT * FROM grants").all()).toEqual([]);
    db.sql.exec("DROP TRIGGER fail_request");
    let calls = 0;
    const unstable = new HrService(db, async () => {
      calls++;
      db.sql
        .prepare("UPDATE employees SET version = version + 1 WHERE id = 'cora'")
        .run();
    });
    await expect(unstable.profile("ben", "cora")).rejects.toMatchObject({
      status: 409,
    });
    expect(calls).toBe(2);
  });
  it("retains paired separation fixtures and server-owned read/execute inputs without pretending to evaluate policy", async () => {
    const { db, service } = fixture();
    const request = await service.request("lin", "cora", 1);
    const inputs: DecisionInput[] = [];
    const observe = new HrService(db, async (input) => {
      inputs.push(input);
    });
    await observe.grant("lin", request.id, "review");
    db.sql
      .prepare("UPDATE grants SET requesterId = 'nia' WHERE id = ?")
      .run(request.id);
    await observe.grant("lin", request.id, "review");
    expect(inputs[0]?.facts.principal).toEqual(inputs[1]?.facts.principal);
    expect(inputs[0]?.facts.principal.reviewer).toBe(1);
    expect(inputs.map((input) => input.facts.grant?.requesterId)).toEqual([
      "lin",
      "nia",
    ]);
    await observe.transition("lin", request.id, 1, "approve");
    expect(inputs.at(-1)).toMatchObject({
      capability: "grant.approve",
      intent: "execute",
      parameters: { expectedVersion: 1 },
    });
  });
  it("keeps the three intentional gaps and terminal history, then permits a fresh request", async () => {
    const { service } = fixture();
    expect(await service.contact("ben", "cora")).toMatchObject({
      workEmail: "cora@example.test",
    });
    const pending = await service.request("lin", "cora", 1);
    const approved = await service.transition(
      "lin",
      pending.id,
      pending.version,
      "approve",
    );
    expect(approved.status).toBe("approved");
    const revoked = await service.transition(
      "nia",
      approved.id,
      approved.version,
      "revoke",
    );
    expect(revoked.status).toBe("revoked");
    expect(await service.contact("ben", "cora")).toHaveProperty("workPhone");
    expect(await service.grants("lin", "review")).toEqual([revoked]);
    expect((await service.request("lin", "cora", 1)).status).toBe("pending");
  });
  it("enforces uniqueness, transitions, tenant containment and expected versions natively", async () => {
    const { service } = fixture();
    const pending = await service.request("lin", "cora", 1);
    await expect(service.request("lin", "cora", 1)).rejects.toMatchObject({
      status: 409,
      code: "ACTIVE_GRANT_EXISTS",
      message: "Ben already has active access to Cora.",
    });
    await expect(
      service.transition("nia", pending.id, 1, "revoke"),
    ).rejects.toMatchObject({ status: 409 });
    await service.transition("nia", pending.id, 1, "approve");
    await expect(
      service.transition("nia", pending.id, 1, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.profile("ben", "foreign")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("keeps profile and contact projections separate and fails unavailable without a write", async () => {
    const { db, service } = fixture();
    expect(Object.keys(await service.profile("ben", "cora"))).toEqual([
      "id",
      "name",
      "managerId",
      "managerName",
      "team",
      "jobTitle",
      "version",
    ]);
    await expect(
      new HrService(db, unavailable).request("lin", "cora", 1),
    ).rejects.toMatchObject({ status: 503 });
    expect(await service.grants("lin", "requests")).toEqual([]);
  });
});
