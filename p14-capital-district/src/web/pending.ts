import {
  CAPABILITIES,
  type GameCommand,
  type Preset,
} from "../shared/contracts";
import { MAX_GAME_NAME_LENGTH, validIdempotencyKey } from "../shared/rules";

export type Pending = { key: string } & (
  | { kind: "create"; name: string; preset: Preset }
  | { kind: "command"; matchId: string; command: GameCommand }
);

function storageKey(actorId: string) {
  return `p14:unconfirmed:${actorId}`;
}

export function savePending(actorId: string, value: Pending | null) {
  try {
    if (value)
      sessionStorage.setItem(storageKey(actorId), JSON.stringify(value));
    else sessionStorage.removeItem(storageKey(actorId));
  } catch {
    /* In-memory recovery remains available if browser storage is disabled. */
  }
}

export function loadPending(actorId: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(storageKey(actorId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("key" in value) ||
      !validIdempotencyKey(value.key) ||
      !("kind" in value)
    )
      return null;
    if (
      value.kind === "create" &&
      "name" in value &&
      typeof value.name === "string" &&
      value.name.trim().length >= 1 &&
      value.name.trim().length <= MAX_GAME_NAME_LENGTH &&
      "preset" in value &&
      (value.preset === "normal" || value.preset === "practice")
    )
      return value as Pending;
    if (
      value.kind === "command" &&
      "matchId" in value &&
      typeof value.matchId === "string" &&
      /^[a-zA-Z0-9-]+$/.test(value.matchId) &&
      "command" in value
    ) {
      const command = value.command;
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        typeof command.type === "string" &&
        [...CAPABILITIES, "join", "leave"].some(
          (type) => type === command.type,
        ) &&
        "expectedVersion" in command &&
        Number.isSafeInteger(command.expectedVersion) &&
        "payload" in command &&
        command.payload &&
        typeof command.payload === "object"
      )
        return value as Pending;
    }
  } catch {
    /* Ignore unusable browser state. The server validates every retry. */
  }
  return null;
}
