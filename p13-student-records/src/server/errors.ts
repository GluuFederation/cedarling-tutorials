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
  new AppError(404, "NOT_FOUND", "Grade not found or unavailable.");
export const conflict = () =>
  new AppError(
    409,
    "CONFLICT",
    "The grade or its relationships changed. Reload and try again.",
  );
export const unauthorized = () =>
  new AppError(401, "AUTHENTICATION_REQUIRED", "Sign in again.");
export const invalid = () =>
  new AppError(400, "INVALID_INPUT", "Check the submitted fields.");
