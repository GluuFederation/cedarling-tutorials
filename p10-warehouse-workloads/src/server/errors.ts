import type { FastifyReply, FastifyRequest } from "fastify";

export class DomainError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const malformedRequestErrors: Readonly<Record<number, string>> = {
  400: "body_invalid",
  413: "body_too_large",
  415: "content_type_invalid",
};

export function requestError(
  error: unknown,
  fallbackCode: string,
): DomainError {
  if (error instanceof DomainError) return error;
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number(error.statusCode)
      : 0;
  const code = malformedRequestErrors[statusCode];
  return code
    ? new DomainError(code, statusCode)
    : new DomainError(fallbackCode, 503);
}

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  void reply.code(404).send({ error: "not_found", requestId: request.id });
}
