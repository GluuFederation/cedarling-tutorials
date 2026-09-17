import type { WorkloadCommand } from "./types.ts";

export const CAPABILITIES = {
  "inventory.list": {
    capability: "inventory.read",
    action: "Inventory::Read",
  },
  "transfer.list": {
    capability: "transfer.read",
    action: "Transfer::Read",
  },
  "transfer.read": {
    capability: "transfer.read",
    action: "Transfer::Read",
  },
  "transfer.create": {
    capability: "transfer.create",
    action: "Transfer::Create",
  },
  "transfer.release": {
    capability: "transfer.release",
    action: "Transfer::Release",
  },
  "transfer.receive": {
    capability: "transfer.receive",
    action: "Transfer::Receive",
  },
} as const;

export type Capability =
  (typeof CAPABILITIES)[keyof typeof CAPABILITIES]["capability"];
export type CedarAction =
  (typeof CAPABILITIES)[keyof typeof CAPABILITIES]["action"];

export function commandCapability(command: WorkloadCommand) {
  return CAPABILITIES[command.type];
}
