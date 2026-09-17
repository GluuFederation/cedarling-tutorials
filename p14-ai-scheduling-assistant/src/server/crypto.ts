import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function digest(value: unknown): string {
  return hash(JSON.stringify(value));
}

export function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptJson<T>(value: string, key: Buffer): T {
  const parts = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const [iv, tag, encrypted] = parts;
  if (!iv || !tag || !encrypted || parts.length !== 3)
    throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    ),
  ) as T;
}
