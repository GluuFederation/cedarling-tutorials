import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  type SkuId,
  skuIds,
  type WarehouseId,
  type WorkloadId,
  warehouseIds,
} from "../shared/catalog.ts";
import type {
  InventoryRow,
  Transfer,
  TransferStatus,
} from "../shared/types.ts";
import { DomainError } from "./errors.ts";

type TransferRow = Readonly<{
  id: string;
  source_id: WarehouseId;
  destination_id: WarehouseId;
  sku_id: SkuId;
  quantity: number;
  status: TransferStatus;
  version: number;
  created_by: WorkloadId;
  created_at: string;
}>;

function transfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    sourceId: row.source_id,
    destinationId: row.destination_id,
    skuId: row.sku_id,
    quantity: row.quantity,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class WarehouseDatabase {
  readonly sqlite: Database.Database;

  constructor(filename: string) {
    this.sqlite = new Database(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("journal_mode = WAL");
    this.migrate();
    this.seed();
  }

  close(): void {
    this.sqlite.close();
  }

  reset(): void {
    this.sqlite.exec(`
      DELETE FROM idempotency;
      DELETE FROM transfers;
      DELETE FROM inventory;
    `);
    this.seed();
  }

  listInventory(): readonly InventoryRow[] {
    return this.sqlite
      .prepare(
        `SELECT warehouse_id AS warehouseId, sku_id AS skuId, quantity
         FROM inventory ORDER BY warehouse_id, sku_id`,
      )
      .all() as InventoryRow[];
  }

  getInventory(
    warehouseId: WarehouseId,
    skuId: SkuId,
  ): InventoryRow | undefined {
    return this.sqlite
      .prepare(
        `SELECT warehouse_id AS warehouseId, sku_id AS skuId, quantity
         FROM inventory WHERE warehouse_id = ? AND sku_id = ?`,
      )
      .get(warehouseId, skuId) as InventoryRow | undefined;
  }

  listTransfers(): readonly Transfer[] {
    return (
      this.sqlite
        .prepare(
          "SELECT * FROM transfers ORDER BY created_at DESC, id LIMIT 50",
        )
        .all() as TransferRow[]
    ).map(transfer);
  }

  getTransfer(id: string): Transfer | undefined {
    const row = this.sqlite
      .prepare("SELECT * FROM transfers WHERE id = ?")
      .get(id) as TransferRow | undefined;
    return row ? transfer(row) : undefined;
  }

  createTransfer(input: {
    workloadId: WorkloadId;
    sourceId: WarehouseId;
    destinationId: WarehouseId;
    skuId: SkuId;
    quantity: number;
    idempotencyKey: string;
  }): Transfer {
    if (
      !warehouseIds.has(input.sourceId) ||
      !warehouseIds.has(input.destinationId)
    ) {
      throw new DomainError("warehouse_invalid", 400);
    }
    if (input.sourceId === input.destinationId) {
      throw new DomainError("warehouse_pair_invalid", 400);
    }
    if (!skuIds.has(input.skuId)) throw new DomainError("sku_invalid", 400);
    if (
      !Number.isSafeInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1_000
    ) {
      throw new DomainError("quantity_invalid", 400);
    }
    const command = {
      type: "transfer.create",
      sourceId: input.sourceId,
      destinationId: input.destinationId,
      skuId: input.skuId,
      quantity: input.quantity,
    };
    return this.idempotent(
      input.workloadId,
      input.idempotencyKey,
      command,
      () => {
        const result: Transfer = {
          id: `trf_${randomUUID()}`,
          sourceId: input.sourceId,
          destinationId: input.destinationId,
          skuId: input.skuId,
          quantity: input.quantity,
          status: "planned",
          version: 1,
          createdBy: input.workloadId,
          createdAt: new Date().toISOString(),
        };
        this.sqlite
          .prepare(
            `INSERT INTO transfers
           (id, source_id, destination_id, sku_id, quantity, status, version, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            result.id,
            result.sourceId,
            result.destinationId,
            result.skuId,
            result.quantity,
            result.status,
            result.version,
            result.createdBy,
            result.createdAt,
          );
        return result;
      },
    );
  }

  transition(input: {
    workloadId: WorkloadId;
    transferId: string;
    operation: "release" | "receive";
    expectedVersion: number;
    idempotencyKey: string;
  }): Transfer {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    ) {
      throw new DomainError("version_invalid", 400);
    }
    const command = {
      type: `transfer.${input.operation}`,
      transferId: input.transferId,
      expectedVersion: input.expectedVersion,
    };
    return this.idempotent(
      input.workloadId,
      input.idempotencyKey,
      command,
      () => {
        const current = this.getTransfer(input.transferId);
        if (!current) throw new DomainError("transfer_not_found", 404);
        if (current.version !== input.expectedVersion) {
          throw new DomainError("version_conflict", 409);
        }
        const expectedStatus =
          input.operation === "release" ? "planned" : "in_transit";
        if (current.status !== expectedStatus) {
          throw new DomainError("transition_invalid", 409);
        }
        const warehouseId =
          input.operation === "release"
            ? current.sourceId
            : current.destinationId;
        const delta =
          input.operation === "release" ? -current.quantity : current.quantity;
        const inventory = this.sqlite
          .prepare(
            "SELECT quantity FROM inventory WHERE warehouse_id = ? AND sku_id = ?",
          )
          .get(warehouseId, current.skuId) as { quantity: number } | undefined;
        if (!inventory) throw new DomainError("inventory_not_found", 409);
        if (inventory.quantity + delta < 0) {
          throw new DomainError("insufficient_stock", 409);
        }
        this.sqlite
          .prepare(
            "UPDATE inventory SET quantity = quantity + ? WHERE warehouse_id = ? AND sku_id = ?",
          )
          .run(delta, warehouseId, current.skuId);
        const status =
          input.operation === "release" ? "in_transit" : "received";
        const changed = this.sqlite
          .prepare(
            `UPDATE transfers SET status = ?, version = version + 1
           WHERE id = ? AND version = ? AND status = ?`,
          )
          .run(status, current.id, current.version, expectedStatus);
        if (changed.changes !== 1)
          throw new DomainError("version_conflict", 409);
        const result = this.getTransfer(current.id);
        if (!result) throw new Error("Updated transfer disappeared");
        return result;
      },
    );
  }

  private idempotent<T>(
    workloadId: WorkloadId,
    key: string,
    command: unknown,
    effect: () => T,
  ): T {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(key)) {
      throw new DomainError("idempotency_key_invalid", 400);
    }
    const commandHash = hash(command);
    return this.sqlite.transaction(() => {
      const existing = this.sqlite
        .prepare(
          "SELECT command_hash, response_json FROM idempotency WHERE workload_id = ? AND key = ?",
        )
        .get(workloadId, key) as
        | { command_hash: string; response_json: string }
        | undefined;
      if (existing) {
        if (existing.command_hash !== commandHash) {
          throw new DomainError("idempotency_conflict", 409);
        }
        return JSON.parse(existing.response_json) as T;
      }
      const result = effect();
      this.sqlite
        .prepare(
          "INSERT INTO idempotency (workload_id, key, command_hash, response_json) VALUES (?, ?, ?, ?)",
        )
        .run(workloadId, key, commandHash, JSON.stringify(result));
      return result;
    })();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS inventory (
        warehouse_id TEXT NOT NULL,
        sku_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        PRIMARY KEY (warehouse_id, sku_id)
      );
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        sku_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        status TEXT NOT NULL CHECK (status IN ('planned', 'in_transit', 'received')),
        version INTEGER NOT NULL CHECK (version > 0),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        workload_id TEXT NOT NULL,
        key TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        PRIMARY KEY (workload_id, key)
      );
    `);
  }

  private seed(): void {
    const count = this.sqlite
      .prepare("SELECT COUNT(*) AS count FROM inventory")
      .get() as {
      count: number;
    };
    if (count.count > 0) return;
    const insertInventory = this.sqlite.prepare(
      "INSERT INTO inventory (warehouse_id, sku_id, quantity) VALUES (?, ?, ?)",
    );
    const insertTransfer = this.sqlite.prepare(
      `INSERT INTO transfers
       (id, source_id, destination_id, sku_id, quantity, status, version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'transfer-planner', ?)`,
    );
    this.sqlite.transaction(() => {
      for (const row of [
        ["north", "bearing-kit", 80],
        ["north", "safety-gloves", 140],
        ["north", "sensor-pack", 55],
        ["south", "bearing-kit", 62],
        ["south", "safety-gloves", 105],
        ["south", "sensor-pack", 34],
      ] as const) {
        insertInventory.run(...row);
      }
      insertTransfer.run(
        "trf_north_south_planned",
        "north",
        "south",
        "bearing-kit",
        12,
        "planned",
        1,
        "2026-09-16T08:00:00.000Z",
      );
      insertTransfer.run(
        "trf_south_north_transit",
        "south",
        "north",
        "sensor-pack",
        6,
        "in_transit",
        2,
        "2026-09-16T07:00:00.000Z",
      );
      insertTransfer.run(
        "trf_north_south_received",
        "north",
        "south",
        "safety-gloves",
        20,
        "received",
        3,
        "2026-09-16T06:00:00.000Z",
      );
    })();
  }
}
