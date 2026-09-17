import type { SkuId, WarehouseId, WorkloadId } from "./catalog.ts";

export type TransferStatus = "planned" | "in_transit" | "received";

export type InventoryRow = Readonly<{
  warehouseId: WarehouseId;
  skuId: SkuId;
  quantity: number;
}>;

export type Transfer = Readonly<{
  id: string;
  sourceId: WarehouseId;
  destinationId: WarehouseId;
  skuId: SkuId;
  quantity: number;
  status: TransferStatus;
  version: number;
  createdBy: WorkloadId;
  createdAt: string;
}>;

export type WorkloadCommand =
  | Readonly<{ type: "inventory.list" }>
  | Readonly<{ type: "transfer.list" }>
  | Readonly<{ type: "transfer.read"; transferId: string }>
  | Readonly<{
      type: "transfer.create";
      sourceId: WarehouseId;
      destinationId: WarehouseId;
      skuId: SkuId;
      quantity: number;
      idempotencyKey: string;
    }>
  | Readonly<{
      type: "transfer.release" | "transfer.receive";
      transferId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>;

export type Workspace = Readonly<{
  inventory: readonly InventoryRow[];
  transfers: readonly Transfer[];
}>;
