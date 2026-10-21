export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const missing = () =>
  new AppError(404, "NOT_FOUND", "Resource is unavailable.");
export const conflict = () =>
  new AppError(409, "CONFLICT", "State changed. Refresh and try again.");
export const activeGrantExists = (managerName: string, employeeName: string) =>
  new AppError(
    409,
    "ACTIVE_GRANT_EXISTS",
    `A pending request or approved grant already exists for ${managerName} and ${employeeName}.`,
  );
export const denied = () =>
  new AppError(403, "DENIED", "Access is not allowed.");
export const unauthorized = () =>
  new AppError(401, "SESSION_EXPIRED", "Sign in to continue.");
export function bodyFields(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new AppError(400, "INVALID_INPUT", "Check the submitted fields.");
  return value as Record<string, unknown>;
}
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw new AppError(
      400,
      "INVALID_INPUT",
      "A valid positive number is required.",
    );
  return value;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new AppError(400, "INVALID_INPUT", "A valid identifier is required.");
  return value;
}
export function text(
  value: unknown,
  min: number,
  max: number,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    throw new AppError(400, "INVALID_INPUT", message);
  return value.trim();
}
