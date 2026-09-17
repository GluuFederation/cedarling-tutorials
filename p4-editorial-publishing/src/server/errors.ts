export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function isAppError(error: unknown): error is AppError {
  return (
    error instanceof Error &&
    error.name === "AppError" &&
    typeof (error as Partial<AppError>).status === "number" &&
    typeof (error as Partial<AppError>).code === "string"
  );
}

export const badRequest = (message = "The request is invalid") =>
  new AppError(400, "INVALID_REQUEST", message);
export const unauthorized = () =>
  new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication required");
export const forbidden = () =>
  new AppError(403, "FORBIDDEN", "The request is not allowed");
export const notFound = () =>
  new AppError(404, "NOT_FOUND", "The requested article was not found");
export const conflict = (
  message = "The article changed. Refresh and try again",
) => new AppError(409, "STATE_CONFLICT", message);
