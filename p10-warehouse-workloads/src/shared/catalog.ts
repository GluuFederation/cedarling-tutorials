export const WORKLOADS = [
  {
    id: "transfer-planner",
    label: "Transfer Planner",
    shortLabel: "Planner",
    purpose: "Plans stock movement between warehouses.",
  },
  {
    id: "warehouse-north",
    label: "North Warehouse",
    shortLabel: "North",
    purpose: "Releases and receives North Warehouse stock.",
  },
  {
    id: "warehouse-south",
    label: "South Warehouse",
    shortLabel: "South",
    purpose: "Releases and receives South Warehouse stock.",
  },
  {
    id: "inventory-auditor",
    label: "Inventory Auditor",
    shortLabel: "Auditor",
    purpose: "Reads inventory without changing transfers.",
  },
] as const;

export type WorkloadId = (typeof WORKLOADS)[number]["id"];

export function workloadEnvironmentPrefix(id: WorkloadId): string {
  return `P10_${id.replaceAll("-", "_").toUpperCase()}`;
}

export function workloadAgentPort(id: WorkloadId): number {
  return 3111 + WORKLOADS.findIndex((workload) => workload.id === id);
}

export const WAREHOUSES = [
  { id: "north", label: "North Warehouse" },
  { id: "south", label: "South Warehouse" },
] as const;

export type WarehouseId = (typeof WAREHOUSES)[number]["id"];

export const SKUS = [
  { id: "bearing-kit", label: "Bearing kit" },
  { id: "safety-gloves", label: "Safety gloves" },
  { id: "sensor-pack", label: "Sensor pack" },
] as const;

export type SkuId = (typeof SKUS)[number]["id"];

export const workloadIds = new Set<WorkloadId>(WORKLOADS.map(({ id }) => id));
export const warehouseIds = new Set<WarehouseId>(
  WAREHOUSES.map(({ id }) => id),
);
export const skuIds = new Set<SkuId>(SKUS.map(({ id }) => id));

export function warehouseLabel(id: WarehouseId): string {
  return WAREHOUSES.find((warehouse) => warehouse.id === id)?.label ?? id;
}

export function skuLabel(id: SkuId): string {
  return SKUS.find((sku) => sku.id === id)?.label ?? id;
}
