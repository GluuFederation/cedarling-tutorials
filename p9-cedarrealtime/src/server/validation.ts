import type {
  DeleteInput,
  EnterInput,
  PublishInput,
  RemoveInput,
} from "../shared/protocol.ts";
import { limits } from "./config.ts";
import { DomainError } from "./errors.ts";

const idPattern = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const commandPattern = /^[A-Za-z0-9_-]{8,80}$/u;

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("invalid_event", 400);
  }
  const input = value as Record<string, unknown>;
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new DomainError("invalid_event", 400);
  }
  return input;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new DomainError("invalid_identifier", 400);
  }
  return value;
}

function command(value: unknown): string {
  if (typeof value !== "string" || !commandPattern.test(value)) {
    throw new DomainError("invalid_command_id", 400);
  }
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new DomainError("invalid_version", 400);
  }
  return Number(value);
}

export function enterInput(value: unknown): EnterInput {
  const input = record(value, ["roomId", "lastSequence"]);
  return {
    roomId: id(input.roomId),
    lastSequence: integer(input.lastSequence),
  };
}

export function publishInput(value: unknown): PublishInput {
  const input = record(value, ["roomId", "commandId", "content"]);
  if (typeof input.content !== "string") {
    throw new DomainError("invalid_message", 400);
  }
  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes < 1 || bytes > limits.messageBytes) {
    throw new DomainError("message_size_out_of_bounds", 400);
  }
  return {
    roomId: id(input.roomId),
    commandId: command(input.commandId),
    content: input.content,
  };
}

export function removeInput(value: unknown): RemoveInput {
  const input = record(value, [
    "roomId",
    "userId",
    "commandId",
    "expectedVersion",
  ]);
  return {
    roomId: id(input.roomId),
    userId: id(input.userId),
    commandId: command(input.commandId),
    expectedVersion: integer(input.expectedVersion, 1),
  };
}

export function deleteInput(value: unknown): DeleteInput {
  const input = record(value, [
    "roomId",
    "messageId",
    "commandId",
    "expectedVersion",
  ]);
  return {
    roomId: id(input.roomId),
    messageId: id(input.messageId),
    commandId: command(input.commandId),
    expectedVersion: integer(input.expectedVersion, 1),
  };
}
