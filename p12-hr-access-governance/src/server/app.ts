import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import {
  accessPackages,
  type GrantRequest,
  type SessionView,
} from "../shared/contracts.ts";
import type { OidcRuntime } from "./auth/oidc.ts";
import { registerAuth } from "./auth/routes.ts";
import type { Config } from "./config/environment.ts";
import type { Database } from "./data/database.ts";
import { type Authorize, fakeAuthorize } from "./hr/authorization.ts";
import { HrService } from "./hr/service.ts";
import { AppError, bodyFields, identifier, integer } from "./http/errors.ts";
export function createApp(
  config: Config,
  db: Database,
  oidc: OidcRuntime,
  authorize: Authorize = fakeAuthorize,
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.set({
      "X-Request-Id": response.locals.requestId,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.get("/health", (_request, response) =>
    response.json({ status: "ok", service: "p12-hr-access-governance" }),
  );
  const auth = registerAuth(app, db, config, oidc);
  app.get("/api/session", (request, response) => {
    try {
      const session = auth.session(request);
      const principal = db.principal(session.principalId);
      if (!principal) throw new Error("Unmapped session");
      const data: SessionView = {
        user: { id: principal.id, name: principal.name, role: principal.role },
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      };
      response.json({ data, requestId: response.locals.requestId });
    } catch (error) {
      if (error instanceof AppError && error.status === 401)
        response.json({ data: null, requestId: response.locals.requestId });
      else throw error;
    }
  });
  app.use(
    "/api",
    (request, response, next) => {
      const session = auth.session(request);
      response.locals.actor = session.principalId;
      if (request.method !== "GET" && request.method !== "HEAD") {
        auth.mutation(request, session);
        if (!request.is("application/json"))
          throw new AppError(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Send application/json.",
          );
      }
      next();
    },
    express.json({ limit: "16kb", strict: true }),
  );
  app.get("/api/grants", async (request, response) => {
    const view = request.query.view ?? "review";
    if (view !== "review" && view !== "requests")
      throw new AppError(400, "INVALID_INPUT", "Unknown grant view.");
    response.json({
      data: await new HrService(
        db,
        authorize,
        response.locals.requestId,
      ).grants(
        response.locals.actor,
        view,
        request.query.employeeId === undefined
          ? undefined
          : identifier(request.query.employeeId),
      ),
      requestId: response.locals.requestId,
    });
  });
  app.post("/api/grants", async (request, response) => {
    const input = bodyFields(request.body, [
      "employeeId",
      "packageId",
      "days",
      "reason",
      "beneficiaryId",
    ]);
    const pkg = accessPackages.find((value) => value.id === input.packageId);
    if (!pkg)
      throw new AppError(
        400,
        "INVALID_INPUT",
        "Choose an available access package.",
      );
    const grantRequest: GrantRequest = {
      employeeId: identifier(input.employeeId),
      packageId: pkg.id,
      days: integer(input.days, 7),
      reason: typeof input.reason === "string" ? input.reason : "",
      ...(input.beneficiaryId === undefined
        ? {}
        : { beneficiaryId: identifier(input.beneficiaryId) }),
    };
    response.status(201).json({
      data: await new HrService(
        db,
        authorize,
        response.locals.requestId,
      ).request(response.locals.actor, grantRequest),
      requestId: response.locals.requestId,
    });
  });
  app.get("/api/grants/:id", async (request, response) => {
    const view = request.query.view ?? "review";
    if (view !== "review" && view !== "requests")
      throw new AppError(400, "INVALID_INPUT", "Unknown grant view.");
    response.json({
      data: await new HrService(db, authorize, response.locals.requestId).grant(
        response.locals.actor,
        identifier(request.params.id),
        view,
      ),
      requestId: response.locals.requestId,
    });
  });
  for (const operation of ["approve", "reject", "revoke"] as const)
    app.post(`/api/grants/:id/${operation}`, async (request, response) => {
      const input = bodyFields(
        request.body,
        operation === "reject" ? ["version", "note"] : ["version"],
      );
      response.json({
        data: await new HrService(
          db,
          authorize,
          response.locals.requestId,
        ).transition(
          response.locals.actor,
          identifier(request.params.id),
          integer(input.version),
          operation,
          typeof input.note === "string" ? input.note : "",
        ),
        requestId: response.locals.requestId,
      });
    });
  app.get("/api/access-options", async (_request, response) =>
    response.json({
      data: await new HrService(
        db,
        authorize,
        response.locals.requestId,
      ).options(response.locals.actor),
      requestId: response.locals.requestId,
    }),
  );
  app.get("/api/employees", async (_request, response) =>
    response.json({
      data: await new HrService(
        db,
        authorize,
        response.locals.requestId,
      ).employees(response.locals.actor),
      requestId: response.locals.requestId,
    }),
  );
  for (const group of ["profile", "contact", "medical"] as const)
    app.get(`/api/employees/:id/${group}`, async (request, response) =>
      response.json({
        data: await new HrService(db, authorize, response.locals.requestId)[
          group
        ](response.locals.actor, identifier(request.params.id)),
        requestId: response.locals.requestId,
      }),
    );
  app.use(
    express.static(resolve("dist/web"), {
      index: "index.html",
      dotfiles: "deny",
    }),
  );
  app.get(
    [
      "/employees",
      "/employees/:id",
      "/employees/:id/contact",
      "/employees/:id/medical",
      "/access-requests",
      "/access-requests/new",
      "/access-requests/:id",
    ],
    (_request, response) => {
      response.sendFile(resolve("dist/web/index.html"));
    },
  );
  app.use((_request, _response, next) =>
    next(new AppError(404, "NOT_FOUND", "Resource is unavailable.")),
  );
  const errors: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next,
  ) => {
    let problem =
      error instanceof AppError
        ? error
        : new AppError(
            500,
            "INTERNAL_ERROR",
            "The operation could not complete.",
          );
    if (error instanceof SyntaxError)
      problem = new AppError(400, "INVALID_JSON", "Send a valid JSON object.");
    if (
      error &&
      typeof error === "object" &&
      "type" in error &&
      error.type === "entity.too.large"
    )
      problem = new AppError(413, "BODY_TOO_LARGE", "Request exceeds 16 KiB.");
    if (problem.status >= 500)
      console.error(
        `P12 server | ERROR | ${problem.code} | ${response.locals.requestId}`,
      );
    response.status(problem.status).json({
      error: { code: problem.code, message: problem.message },
      requestId: response.locals.requestId,
    });
  };
  app.use(errors);
  return app;
}
