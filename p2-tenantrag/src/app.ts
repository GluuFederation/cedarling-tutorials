import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import type { Authenticator } from "./auth/authenticator.js";
import {
  ApplicationError,
  invalidRetrieval,
  retrievalUnavailable,
} from "./errors.js";
import { openApiDocument } from "./openapi.js";
import type { RetrievalService } from "./rag/retrieval.js";

const retrievalRequest = z
  .object({
    corpusId: z.string().trim().min(1).max(64),
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(3).default(3),
  })
  .strict();

type ApplicationDependencies = Readonly<{
  authenticator: Authenticator;
  retrievalService: RetrievalService;
}>;

function isRequestInputError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return false;
  }
  return error.statusCode === 400 || error.statusCode === 413;
}

export function createApp(dependencies: ApplicationDependencies) {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    genReqId: () => `req_${randomUUID()}`,
    logger: false,
  });

  app.get("/openapi.json", async () => openApiDocument);

  app.post("/v1/retrievals", async (request) => {
    const input = retrievalRequest.safeParse(request.body);
    if (!input.success) throw invalidRetrieval();

    const principal = await dependencies.authenticator.authenticate(
      request.headers.authorization,
    );
    return dependencies.retrievalService.retrieve(
      request.id,
      principal,
      input.data,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const applicationError =
      error instanceof ApplicationError
        ? error
        : isRequestInputError(error)
          ? invalidRetrieval()
          : retrievalUnavailable();

    void reply.status(applicationError.statusCode).send({
      error: applicationError.code,
      requestId: request.id,
    });
  });

  return app;
}
