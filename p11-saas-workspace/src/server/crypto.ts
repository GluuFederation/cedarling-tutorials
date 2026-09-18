import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString("base64url");

export const tokenHash = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

export const boundToken = (secret: string, purpose: string): string =>
  createHmac("sha256", secret).update(purpose).digest("base64url");

function key(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptJson<T>(value: string, secret: string): T {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("invalid encrypted payload");
  const [ivValue, tagValue, payloadValue] = parts;
  if (!ivValue || !tagValue || !payloadValue) {
    throw new Error("invalid encrypted payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(payloadValue, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
