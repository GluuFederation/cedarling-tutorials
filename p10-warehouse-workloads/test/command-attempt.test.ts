import { describe, expect, it } from "vitest";
import { CommandAttempt } from "../src/web/command-attempt.ts";

const create = {
  type: "transfer.create",
  sourceId: "north",
  destinationId: "south",
  skuId: "bearing-kit",
  quantity: 1,
} as const;

describe("command retries", () => {
  it("retains the exact command and key until the server acknowledges it", () => {
    const attempts = new CommandAttempt();
    const original = attempts.prepare("transfer-planner", create);
    expect(attempts.prepare("transfer-planner", { ...create })).toBe(original);
    attempts.acknowledge();
    expect(
      attempts.prepare("transfer-planner", create).idempotencyKey,
    ).not.toBe(original.idempotencyKey);
  });

  it("starts a new attempt when the workload or command changes", () => {
    const attempts = new CommandAttempt();
    const original = attempts.prepare("transfer-planner", create);
    const auditor = attempts.prepare("inventory-auditor", create);
    expect(auditor.idempotencyKey).not.toBe(original.idempotencyKey);
    const changed = attempts.prepare("inventory-auditor", {
      ...create,
      quantity: 2,
    });
    expect(changed.idempotencyKey).not.toBe(auditor.idempotencyKey);
    const release = attempts.prepare("warehouse-north", {
      type: "transfer.release",
      transferId: "transfer-one",
      expectedVersion: 1,
    });
    expect(release.idempotencyKey).not.toBe(changed.idempotencyKey);
    expect(
      attempts.prepare("warehouse-north", {
        type: "transfer.release",
        transferId: "transfer-two",
        expectedVersion: 1,
      }).idempotencyKey,
    ).not.toBe(release.idempotencyKey);
  });
});
