import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Database } from "../src/server/data/database.ts";
import type { DecisionInput } from "../src/server/hr/authorization.ts";
import { fakeAuthorize } from "../src/server/hr/authorization.ts";
import { HrService } from "../src/server/hr/service.ts";
import { denied } from "../src/server/http/errors.ts";
import { capabilities } from "../src/shared/contracts.ts";
import { contactRequest, medicalRequest } from "./support.ts";

let db: Database;
let service: HrService;
beforeEach(() => {
  db = new Database(":memory:");
  service = new HrService(db, fakeAuthorize);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("starts access at approval and expires pending requests after 24 hours", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
  const request = await service.request("lin", contactRequest("cora", 3));
  expect(request).toMatchObject({
    approvedAt: null,
    expiresAt: null,
    reviewDeadline: Date.now() + 86400000,
  });
  vi.setSystemTime(Date.now() + 12 * 3600000);
  expect(
    await service.transition("nia", request.id, 1, "approve"),
  ).toMatchObject({
    approvedAt: Date.now(),
    expiresAt: Date.now() + 3 * 86400000,
    reviewedBy: "nia",
  });
});
it("keeps medical and contact grants independent", async () => {
  const contact = await service.request("lin", contactRequest());
  const medical = await service.request("lin", medicalRequest());
  expect(contact.beneficiaryId).toBe("ben");
  expect(medical.beneficiaryId).toBe("aya");
  await service.transition("nia", contact.id, 1, "approve");
  await service.transition("nia", medical.id, 1, "approve");
  await service.transition("nia", contact.id, 2, "revoke");
  expect(db.grant(medical.id)?.status).toBe("approved");
  const inputs: DecisionInput[] = [];
  const observe = new HrService(db, async (input) => {
    inputs.push(input);
  });
  await observe.contact("ben", "cora");
  await observe.medical("aya", "cora");
  expect(inputs.map((input) => input.facts.effectiveGrant?.status)).toEqual([
    "revoked",
    "approved",
  ]);
  expect(inputs.map((input) => input.facts.package.id)).toEqual([
    "team-support",
    "occupational-health",
  ]);
});
it("records a declined request and allows a fresh request", async () => {
  const request = await service.request("lin", medicalRequest());
  const rejected = await service.transition(
    "nia",
    request.id,
    1,
    "reject",
    "Please clarify the health review.",
  );
  expect(rejected).toMatchObject({
    status: "rejected",
    reviewedBy: "nia",
    expiresAt: null,
    reviewNote: "Please clarify the health review.",
  });
  await expect(
    service.transition("nia", request.id, 2, "approve"),
  ).rejects.toMatchObject({ status: 409 });
  expect((await service.request("lin", medicalRequest())).status).toBe(
    "pending",
  );
});
it("treats approval expiry as effective immediately and permits a fresh request", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
  const request = await service.request("lin", medicalRequest());
  await service.transition("nia", request.id, 1, "approve");
  vi.setSystemTime(Date.now() + 86400000);
  expect((await service.grant("aya", request.id, "review")).status).toBe(
    "expired",
  );
  await expect(
    service.transition("nia", request.id, 2, "revoke"),
  ).rejects.toMatchObject({ status: 409 });
  await service.request("lin", medicalRequest());
  expect(db.grant(request.id)?.status).toBe("expired");
});
it("does not expose clinical data or contact values in authorization facts", async () => {
  const observe = new HrService(db, async (input) => {
    expect(JSON.stringify(input.facts)).not.toMatch(
      /Seasonal pollen|personal@example|allergies|consultations|Coordinate employee/,
    );
  });
  await observe.contact("ben", "cora");
  await observe.medical("aya", "cora");
  const request = await observe.request("lin", medicalRequest());
  await observe.transition("nia", request.id, 1, "approve");
});
it("rechecks both the medical record and the grant before disclosing clinical values", async () => {
  const request = await service.request("lin", medicalRequest());
  await service.transition("nia", request.id, 1, "approve");
  let calls = 0;
  const guarded = new HrService(db, async (input) => {
    calls++;
    if (calls === 1)
      db.sql
        .prepare(
          "UPDATE grants SET status='revoked',version=version+1 WHERE id=?",
        )
        .run(request.id);
    else {
      expect(input.facts.effectiveGrant?.status).toBe("revoked");
      throw denied();
    }
  });
  await expect(guarded.medical("aya", "cora")).rejects.toMatchObject({
    status: 403,
  });
  expect(calls).toBe(2);
  calls = 0;
  const changed = new HrService(db, async () => {
    calls++;
    db.sql
      .prepare(
        "UPDATE medical_records SET version=version+1 WHERE employeeId='cora'",
      )
      .run();
  });
  await expect(changed.medical("aya", "cora")).rejects.toMatchObject({
    status: 409,
  });
  expect(calls).toBe(2);
});
it("keeps every account and new action permissive without weakening native input rules", async () => {
  for (const actor of ["lin", "nia", "ben", "aya"]) {
    expect(await service.medical(actor, "cora")).toHaveProperty("conditions");
    expect((await service.options(actor)).beneficiaries).toHaveLength(4);
    const request = await service.request(actor, medicalRequest());
    await service.transition(
      actor,
      request.id,
      1,
      "reject",
      "The task is complete.",
    );
  }
  await expect(
    service.request("lin", {
      ...medicalRequest(),
      beneficiaryId: "foreign-manager",
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.request("lin", { ...contactRequest(), beneficiaryId: "aya" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.request("lin", { ...medicalRequest(), reason: "short" }),
  ).rejects.toMatchObject({ status: 400 });
});
it("keeps seven capability seams in safe one-line logs", async () => {
  await service.profile("ben", "cora");
  await service.contact("ben", "cora");
  await service.medical("aya", "cora");
  const request = await service.request("lin", contactRequest());
  await service.transition("lin", request.id, 1, "approve");
  await service.transition("nia", request.id, 2, "revoke");
  const next = await service.request("lin", medicalRequest());
  await service.transition("nia", next.id, 1, "reject", "Case already closed.");
  const lines = vi
    .mocked(console.info)
    .mock.calls.map(([line]) => String(line));
  for (const capability of Object.keys(capabilities))
    expect(lines.some((line) => line.includes(`| ${capability} |`))).toBe(true);
  expect(lines.every((line) => /^P12 server \| FAKE ALLOW \|/.test(line))).toBe(
    true,
  );
  expect(lines.join(" ")).not.toMatch(
    /cora@example|Seasonal pollen|Coordinate employee|Case already closed/,
  );
});
