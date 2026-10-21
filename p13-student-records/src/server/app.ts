import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import type { GradeFilter } from "../shared/contracts.ts";
import {
  type Capability,
  capabilities,
  type ReadCapability,
} from "../shared/contracts.ts";
import type { OidcRuntime } from "./auth/oidc.ts";
import { registerAuth } from "./auth/routes.ts";
import type { AppConfig } from "./config/environment.ts";
import type { SchoolDatabase } from "./data/database.ts";
import { AppError, invalid } from "./http/errors.ts";
import { createAuthorization } from "./school/authorization.ts";
import { type Authorize, School } from "./school/service.ts";
import { Students } from "./school/students.ts";

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
      service: "p13-student-records",
    });
  });
  const auth = registerAuth(app, database, config, oidc);
  const authorize = options.authorize ?? createAuthorization();
  function services(request: import("express").Request) {
    const beforeEffect = () => {
      auth.requireSession(request);
    };
    return {
      school: new School(database, authorize, beforeEffect),
      students: new Students(database, authorize, beforeEffect),
    };
  }
  function identifier(value: unknown): string {
    if (typeof value !== "string" || !/^[-a-zA-Z0-9_]{1,100}$/.test(value))
      throw invalid();
    return value;
  }
  app.get("/api/students", async (request, response) => {
    const session = auth.requireSession(request);
    response.json({
      students: await services(request).students.list(
        session.user.id,
        String(response.locals.requestId),
      ),
    });
  });
  app.get("/api/students/:id", async (request, response) => {
    const session = auth.requireSession(request);
    response.json(
      await services(request).students.read(
        session.user.id,
        identifier(request.params.id),
        String(response.locals.requestId),
      ),
    );
  });
  for (const [key, capability] of Object.entries(capabilities)) {
    if (capability.kind !== "read") continue;
    const read = key as ReadCapability;
    app.get(`/api/grades/${capability.audience}`, async (request, response) => {
      const session = auth.requireSession(request);
      const filter: GradeFilter = {};
      for (const key of Object.keys(request.query))
        if (!["studentId", "courseId", "state"].includes(key)) throw invalid();
      if (request.query.studentId !== undefined)
        filter.studentId = identifier(request.query.studentId);
      if (request.query.courseId !== undefined)
        filter.courseId = identifier(request.query.courseId);
      if (request.query.state !== undefined) {
        if (
          request.query.state !== "draft" &&
          request.query.state !== "published"
        )
          throw invalid();
        filter.state = request.query.state;
      }
      response.json({
        grades: await services(request).school.list(
          session.user.id,
          read,
          String(response.locals.requestId),
          filter,
        ),
      });
    });
    app.get(
      `/api/grades/${capability.audience}/:id`,
      async (request, response) => {
        const session = auth.requireSession(request);
        for (const key of Object.keys(request.query))
          if (key !== "studentId") throw invalid();
        if (
          request.query.studentId !== undefined &&
          database.snapshot(session.user.id, identifier(request.params.id))
            ?.grade.studentId !== identifier(request.query.studentId)
        )
          throw new AppError(
            404,
            "NOT_FOUND",
            "Grade not found or unavailable.",
          );
        response.json(
          await services(request).school.read(
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
          await services(request).school.publish(
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
          await services(request).school.write(
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
  app.get(
    [
      "/",
      "/students",
      "/students/:id",
      "/students/:id/results/student",
      "/students/:id/results/guardian",
      "/students/:id/results/student/:gradeId",
      "/students/:id/results/guardian/:gradeId",
      "/gradebook",
      "/gradebook/:id",
    ],
    (_request, response) => response.sendFile(resolve(webRoot, "index.html")),
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
