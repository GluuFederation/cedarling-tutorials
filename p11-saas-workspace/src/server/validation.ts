import { timingSafeEqual } from "node:crypto";
import { badRequest } from "./errors.ts";
import { limits } from "./limits.ts";

const identifierPattern = /^[a-z][a-z0-9-]{1,63}$/;
const idempotencyPattern = /^[A-Za-z0-9_-]{8,80}$/;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest();
  }
  return value as Record<string, unknown>;
}

export function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw badRequest(`invalid_${name}`);
  }
  return value;
}

export function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw badRequest("invalid_expected_version");
  }
  return Number(value);
}

export function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !idempotencyPattern.test(value)) {
    throw badRequest("invalid_idempotency_key");
  }
  return value;
}

export function requestIdentifier(value: unknown): string {
  if (typeof value !== "string" || !idempotencyPattern.test(value)) {
    throw badRequest("invalid_request_id");
  }
  return value;
}

export function projectName(value: unknown): string {
  if (typeof value !== "string") throw badRequest("invalid_project_name");
  const result = value.trim();
  const hasControlCharacter = [...result].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  });
  if (
    result.length === 0 ||
    [...result].length > limits.projectNameCharacters ||
    hasControlCharacter
  ) {
    throw badRequest("invalid_project_name");
  }
  return result;
}

export function projectBody(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > limits.projectBodyBytes ||
    value.includes("\u0000")
  ) {
    throw badRequest("invalid_project_body");
  }
  return value;
}

export function inviteRole(value: unknown): "editor" | "viewer" {
  if (value !== "editor" && value !== "viewer") {
    throw badRequest("invalid_invitation_role");
  }
  return value;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
