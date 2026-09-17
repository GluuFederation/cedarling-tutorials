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
export const unauthorized = () => new AppError("authentication_required", 401);
export const forbidden = (code = "request_verification_failed") =>
  new AppError(code, 403);
export const notFound = (code = "not_found") => new AppError(code, 404);
export const conflict = (code = "version_conflict") => new AppError(code, 409);
export const unavailable = (code = "authorization_unavailable") =>
  new AppError(code, 503);
