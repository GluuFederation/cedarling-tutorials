import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString("base64url");

export const tokenHash = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

export const contentDigest = (title: string, body: string): string =>
  createHash("sha256")
    .update(`${title.normalize("NFC")}\n${body.normalize("NFC")}`)
    .digest("base64url");

function key(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const payload = Buffer.from(JSON.stringify(value));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

export function decryptJson<T>(value: string, secret: string): T {
  const payload = Buffer.from(value, "base64url");
  if (payload.length < 29) throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    payload.subarray(0, 12),
  );
  decipher.setAuthTag(payload.subarray(12, 28));
  const clear = Buffer.concat([
    decipher.update(payload.subarray(28)),
    decipher.final(),
  ]);
  return JSON.parse(clear.toString("utf8")) as T;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
