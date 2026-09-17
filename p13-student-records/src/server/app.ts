import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import {
  type Capability,
  capabilities,
  type ReadCapability,
} from "../shared/contracts.ts";
import { registerAuth } from "./auth.ts";
import { createAuthorization } from "./authorization.ts";
import type { AppConfig } from "./config.ts";
import type { SchoolDatabase } from "./database.ts";
import { AppError, invalid } from "./errors.ts";
import type { OidcRuntime } from "./oidc.ts";
import { type Authorize, School } from "./school.ts";

function fields(value: unknown, names: string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !names.includes(key)) ||
    names.some((key) => !(key in value))
  )
    throw invalid();
  return value as Record<string, unknown>;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw invalid();
  return value;
}

export function buildApp(options: {
  config: AppConfig;
  database: SchoolDatabase;
  oidc: OidcRuntime;
  authorize?: Authorize;
}) {
  const { config, database, oidc } = options;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.set({
      "X-Request-ID": response.locals.requestId,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });
  app.use(express.json({ limit: 16 * 1024, strict: true }));
  app.get("/health", (_request, response) => {
    database.sql.prepare("SELECT 1").get();
    response.json({
      status: "ok",
      authorizationMode: "permissive",
    });
  });
  const auth = registerAuth(app, database, config, oidc);
  const school = new School(
    database,
    options.authorize ?? createAuthorization(),
  );
  for (const [key, capability] of Object.entries(capabilities)) {
    if (capability.kind !== "read") continue;
    const read = key as ReadCapability;
    app.get(`/api/grades/${capability.audience}`, async (request, response) => {
      const session = auth.requireSession(request);
      response.json({
        grades: await school.list(
          session.user.id,
          read,
          String(response.locals.requestId),
        ),
      });
    });
    app.get(
      `/api/grades/${capability.audience}/:id`,
      async (request, response) => {
        const session = auth.requireSession(request);
        response.json(
          await school.read(
            session.user.id,
            read,
            request.params.id,
            String(response.locals.requestId),
          ),
        );
      },
    );
  }
  for (const capability of [
    "grade.write",
    "grade.publish",
  ] satisfies Capability[]) {
    const path =
      capability === "grade.write"
        ? "/api/grades/:id"
        : "/api/grades/:id/publish";
    const method = capability === "grade.write" ? "patch" : "post";
    app[method](path, async (request, response) => {
      const session = auth.requireSession(request);
      auth.requireMutation(request, session);
      if (!request.is("application/json"))
        throw new AppError(415, "INVALID_MEDIA_TYPE", "Use application/json.");
      const body = fields(
        request.body,
        capability === "grade.write"
          ? ["expectedVersion", "score", "feedback", "internalNote"]
          : ["expectedVersion"],
      );
      const expectedVersion = version(body.expectedVersion);
      const requestId = String(response.locals.requestId);
      if (capability === "grade.publish")
        response.json(
          await school.publish(
            session.user.id,
            request.params.id,
            expectedVersion,
            requestId,
          ),
        );
      else {
        if (
          (body.score !== null && typeof body.score !== "number") ||
          typeof body.feedback !== "string" ||
          typeof body.internalNote !== "string"
        )
          throw invalid();
        response.json(
          await school.write(
            session.user.id,
            request.params.id,
            {
              expectedVersion,
              score: body.score,
              feedback: body.feedback,
              internalNote: body.internalNote,
            },
            requestId,
          ),
        );
      }
    });
  }
  const webRoot = resolve("dist/web");
  app.use(express.static(webRoot, { dotfiles: "deny", index: false }));
  app.get("/", (_request, response) =>
    response.sendFile(resolve(webRoot, "index.html")),
  );
  app.use((_request, _response, next) =>
    next(new AppError(404, "NOT_FOUND", "Not found.")),
  );
  const errors: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    let safe =
      error instanceof AppError
        ? error
        : new AppError(500, "INTERNAL_ERROR", "Request failed. Try again.");
    if (typeof error === "object" && error !== null && "type" in error) {
      if (error.type === "entity.too.large")
        safe = new AppError(413, "BODY_TOO_LARGE", "Request is too large.");
      if (error.type === "entity.parse.failed") safe = invalid();
    }
    if (error instanceof URIError) safe = invalid();
    response.status(safe.status).json({
      error: safe.code,
      message: safe.message,
      requestId: String(response.locals.requestId),
    });
  };
  app.use(errors);
  return app;
}
