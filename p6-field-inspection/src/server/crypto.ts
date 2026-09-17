import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
