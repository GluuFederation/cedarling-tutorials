export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
