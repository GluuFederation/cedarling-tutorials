export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const badRequest = (code = "invalid_request") => new AppError(code, 400);
export const forbidden = (code = "request_verification_failed") =>
  new AppError(code, 403);
export const notFound = (code = "not_found") => new AppError(code, 404);
export const conflict = (code = "version_conflict") => new AppError(code, 409);
export const isDenied = (error: unknown): error is AppError =>
  error instanceof AppError && error.code === "authorization_denied";

/** Only known connection/transaction failures are safe to translate into retries. */
export function databaseFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return (
    /^(08|53|57P0)/u.test(code) ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "EPIPE",
      "ETIMEDOUT",
      "ENETUNREACH",
      "EAI_AGAIN",
      "ENOTFOUND",
      "40001",
      "40P01",
    ].includes(code) ||
    /^(Connection terminated|Connection closed|timeout exceeded when trying to connect)/u.test(
      error.message,
    )
  );
}
