import type { SkuId, WarehouseId } from "../shared/catalog.ts";
import { skuIds, warehouseIds } from "../shared/catalog.ts";
import type { WorkloadCommand } from "../shared/types.ts";
import { DomainError } from "./errors.ts";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("body_invalid", 400);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new DomainError("body_fields_invalid", 400);
  }
}

function string(value: unknown, code: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new DomainError(code, 400);
  return value;
}

function integer(value: unknown, code: string, maximum = 1_000): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  ) {
    throw new DomainError(code, 400);
  }
  return value as number;
}

const id = (value: unknown) =>
  string(value, "transfer_id_invalid", /^[a-z0-9_-]{3,80}$/u);
const key = (value: unknown) =>
  string(value, "idempotency_key_invalid", /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu);

export function parseCommand(value: unknown): WorkloadCommand {
  const body = record(value);
  const type = body.type;
  if (type === "inventory.list" || type === "transfer.list") {
    exact(body, ["type"]);
    return { type };
  }
  if (type === "transfer.read") {
    exact(body, ["type", "transferId"]);
    return { type, transferId: id(body.transferId) };
  }
  if (type === "transfer.create") {
    exact(body, [
      "type",
      "sourceId",
      "destinationId",
      "skuId",
      "quantity",
      "idempotencyKey",
    ]);
    if (!warehouseIds.has(body.sourceId as WarehouseId))
      throw new DomainError("warehouse_invalid", 400);
    if (!warehouseIds.has(body.destinationId as WarehouseId))
      throw new DomainError("warehouse_invalid", 400);
    if (!skuIds.has(body.skuId as SkuId))
      throw new DomainError("sku_invalid", 400);
    return {
      type,
      sourceId: body.sourceId as WarehouseId,
      destinationId: body.destinationId as WarehouseId,
      skuId: body.skuId as SkuId,
      quantity: integer(body.quantity, "quantity_invalid"),
      idempotencyKey: key(body.idempotencyKey),
    };
  }
  if (type === "transfer.release" || type === "transfer.receive") {
    exact(body, ["type", "transferId", "expectedVersion", "idempotencyKey"]);
    return {
      type,
      transferId: id(body.transferId),
      expectedVersion: integer(
        body.expectedVersion,
        "version_invalid",
        Number.MAX_SAFE_INTEGER,
      ),
      idempotencyKey: key(body.idempotencyKey),
    };
  }
  throw new DomainError("command_invalid", 400);
}
