import { describe, expect, it } from "vitest";
import { WarehouseDatabase } from "../src/server/database.ts";
import { DomainError } from "../src/server/errors.ts";

describe("warehouse state", () => {
  it("moves stock exactly once across the bounded transfer lifecycle", () => {
    const database = new WarehouseDatabase(":memory:");
    try {
      const created = database.createTransfer({
        workloadId: "transfer-planner",
        sourceId: "north",
        destinationId: "south",
        skuId: "bearing-kit",
        quantity: 7,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      });
      const released = database.transition({
        workloadId: "warehouse-north",
        transferId: created.id,
        operation: "release",
        expectedVersion: created.version,
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      });
      const replay = database.transition({
        workloadId: "warehouse-north",
        transferId: created.id,
        operation: "release",
        expectedVersion: created.version,
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      });
      expect(replay).toEqual(released);
      expect(
        database
          .listInventory()
          .find(
            (row) => row.warehouseId === "north" && row.skuId === "bearing-kit",
          )?.quantity,
      ).toBe(73);
      database.transition({
        workloadId: "warehouse-south",
        transferId: created.id,
        operation: "receive",
        expectedVersion: released.version,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      });
      expect(
        database
          .listInventory()
          .find(
            (row) => row.warehouseId === "south" && row.skuId === "bearing-kit",
          )?.quantity,
      ).toBe(69);
    } finally {
      database.close();
    }
  });

  it("rejects stale versions without changing inventory", () => {
    const database = new WarehouseDatabase(":memory:");
    try {
      const before = database.listInventory();
      expect(() =>
        database.transition({
          workloadId: "warehouse-north",
          transferId: "trf_north_south_planned",
          operation: "release",
          expectedVersion: 9,
          idempotencyKey: "44444444-4444-4444-8444-444444444444",
        }),
      ).toThrow(DomainError);
      expect(database.listInventory()).toEqual(before);
    } finally {
      database.close();
    }
  });
});
