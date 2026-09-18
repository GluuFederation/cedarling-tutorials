import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { capabilities } from "../shared/capabilities.ts";
import { checklistKeys } from "../shared/catalog.ts";
import type {
  AuthorizationEnvelope,
  InspectionSubmission,
  Reassignment,
  Session,
  WorkOrder,
  WorkOrderCreation,
  WorkOrderDeletion,
  WorkOrderDetail,
} from "../shared/types.ts";
import type { AuthorizationPort } from "./authorization.ts";
import type { Config } from "./config.ts";
import { type AppDatabase, type AppSession, DomainError } from "./database.ts";
import type { OidcRuntime } from "./oidc.ts";

const sessionCookie = "p6_session";
const transactionCookie = "p6_oidc";
const identities = new Set(["elena", "malik", "rowan"]);

type Dependencies = Readonly<{
  config: Config;
  database: AppDatabase;
  oidc: OidcRuntime;
  authorization: AuthorizationPort;
  serveWeb?: boolean;
}>;

export async function createApp(
  dependencies: Dependencies,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const domain = error instanceof DomainError ? error : undefined;
    const reportedStatus =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const status =
      domain?.status ??
      (reportedStatus && reportedStatus < 500 ? reportedStatus : 500);
    const code =
      domain?.code ??
      (status < 500 ? "invalid_request" : "service_unavailable");
    if (status >= 500) {
      console.error("P6 request failed", {
        requestId: request.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
    void reply.status(status).send({ error: code, requestId: request.id });
  });

  app.get("/healthz", async () => ({
    status: "ok",
    service: "p6-field-inspection",
  }));

  app.get<{ Querystring: { login_hint?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const hint = request.query.login_hint;
      if (!hint || !identities.has(hint))
        throw new DomainError("invalid_identity", 400);
      const transaction = dependencies.database.createLoginTransaction();
      const url = await dependencies.oidc.authorizationUrl(transaction, hint);
      reply.setCookie(
        transactionCookie,
        transaction.id,
        cookieOptions(dependencies.config, 120),
      );
      return reply.redirect(url.toString());
    },
  );

  app.get("/auth/callback", async (request, reply) => {
    const raw = request.cookies[transactionCookie];
    if (!raw) throw new DomainError("invalid_login_transaction", 400);
    const transaction = dependencies.database.consumeLoginTransaction(raw);
    reply.clearCookie(transactionCookie, cookieOptions(dependencies.config));
    if (!transaction) throw new DomainError("invalid_login_transaction", 400);
    const identity = await dependencies.oidc.exchange(
      new URL(request.raw.url ?? "/auth/callback", dependencies.config.baseUrl),
      transaction,
    );
    const user = dependencies.database.findUser(
      dependencies.config.issuer,
      identity.subject,
    );
    if (!user) throw new DomainError("unmapped_identity", 403);
    const created = dependencies.database.createSession(
      user.id,
      identity.expiresAt,
    );
    reply.setCookie(
      sessionCookie,
      created.id,
      cookieOptions(dependencies.config, 30 * 60),
    );
    return reply.redirect("/");
  });

  app.post("/auth/logout", async (request, reply) => {
    requireMutationSession(request, dependencies);
    const raw = request.cookies[sessionCookie];
    if (raw) dependencies.database.destroySession(raw);
    reply.clearCookie(sessionCookie, cookieOptions(dependencies.config));
    return reply.status(204).send();
  });

  app.get("/api/session", async (request): Promise<Session> => {
    const session = requireSession(request, dependencies.database);
    return {
      user: session.user,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  });

  app.get("/api/work-orders", async (request) => {
    const session = requireSession(request, dependencies.database);
    const createAllowed = await dependencies.authorization.authorize({
      requestId: request.id,
      capability: capabilities.create,
      principalId: session.user.id,
      resourceId: "work-orders",
    });
    const candidates = dependencies.database.listWorkOrders(20);
    const workOrders: WorkOrder[] = [];
    for (const candidate of candidates) {
      if (
        await dependencies.authorization.authorize({
          requestId: request.id,
          capability: capabilities.read,
          principalId: session.user.id,
          resourceId: candidate.id,
        })
      ) {
        workOrders.push(candidate);
      }
    }
    return { workOrders, createAllowed };
  });

  app.post("/api/work-orders", async (request, reply) => {
    const session = requireMutationSession(request, dependencies);
    const input = workOrderCreation(request.body);
    const allowed = await dependencies.authorization.authorize({
      requestId: request.id,
      capability: capabilities.create,
      principalId: session.user.id,
      resourceId: "work-orders",
    });
    if (!allowed) throw new DomainError("forbidden", 403);
    return reply.status(201).send({
      workOrder: dependencies.database.createWorkOrder(input),
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/work-orders/:id",
    async (request) => {
      const session = requireSession(request, dependencies.database);
      const id = identifier(request.params.id);
      const workOrder = dependencies.database.findWorkOrder(id);
      if (!workOrder) throw new DomainError("not_found", 404);
      const allowed = await dependencies.authorization.authorize({
        requestId: request.id,
        capability: capabilities.read,
        principalId: session.user.id,
        resourceId: workOrder.id,
      });
      if (!allowed) throw new DomainError("not_found", 404);
      return detail(
        workOrder,
        await envelope(
          request.id,
          session,
          workOrder,
          dependencies.authorization,
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/work-orders/:id/inspections",
    async (request) => {
      const session = requireMutationSession(request, dependencies);
      const id = identifier(request.params.id);
      const input = inspectionSubmission(request.body);
      const workOrder = dependencies.database.findWorkOrder(id);
      if (!workOrder) throw new DomainError("not_found", 404);
      const allowed = await dependencies.authorization.authorize({
        requestId: request.id,
        capability: capabilities.submit,
        principalId: session.user.id,
        resourceId: workOrder.id,
      });
      if (!allowed) throw new DomainError("forbidden", 403);
      return dependencies.database.submit({
        principalId: session.user.id,
        workOrderId: id,
        capturedAssignmentEpoch: workOrder.assignmentEpoch,
        ...input,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/work-orders/:id",
    async (request, reply) => {
      const session = requireMutationSession(request, dependencies);
      const id = identifier(request.params.id);
      const input = workOrderDeletion(request.body);
      const workOrder = dependencies.database.findWorkOrder(id);
      if (!workOrder) throw new DomainError("not_found", 404);
      const allowed = await dependencies.authorization.authorize({
        requestId: request.id,
        capability: capabilities.delete,
        principalId: session.user.id,
        resourceId: workOrder.id,
      });
      if (!allowed) throw new DomainError("forbidden", 403);
      dependencies.database.deleteWorkOrder({ workOrderId: id, ...input });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/work-orders/:id/reassignment",
    async (request) => {
      const session = requireMutationSession(request, dependencies);
      const id = identifier(request.params.id);
      const input = reassignment(request.body);
      const workOrder = dependencies.database.findWorkOrder(id);
      if (!workOrder) throw new DomainError("not_found", 404);
      const allowed = await dependencies.authorization.authorize({
        requestId: request.id,
        capability: capabilities.reassign,
        principalId: session.user.id,
        resourceId: workOrder.id,
      });
      if (!allowed) throw new DomainError("forbidden", 403);
      return {
        workOrder: dependencies.database.reassign({
          workOrderId: id,
          ...input,
        }),
      };
    },
  );

  if (dependencies.serveWeb !== false) {
    await app.register(staticPlugin, {
      root: resolve("dist/web"),
      wildcard: false,
    });
  }
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: "not_found", requestId: request.id }),
  );
  return app;
}

function cookieOptions(config: Config, maxAge?: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(config.baseUrl).protocol === "https:",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function requireSession(
  request: FastifyRequest,
  database: AppDatabase,
): AppSession {
  const raw = request.cookies[sessionCookie];
  const session = raw ? database.findSession(raw) : undefined;
  if (!session) throw new DomainError("authentication_required", 401);
  return session;
}

function requireMutationSession(
  request: FastifyRequest,
  dependencies: Dependencies,
): AppSession {
  const session = requireSession(request, dependencies.database);
  if (request.headers.origin !== dependencies.config.baseUrl) {
    throw new DomainError("invalid_origin", 403);
  }
  const csrf = request.headers["x-csrf-token"];
  if (
    typeof csrf !== "string" ||
    !dependencies.database.csrfMatches(session, csrf)
  ) {
    throw new DomainError("invalid_csrf", 403);
  }
  return session;
}

async function envelope(
  requestId: string,
  session: AppSession,
  workOrder: WorkOrder,
  authorization: AuthorizationPort,
): Promise<AuthorizationEnvelope> {
  const relevant = [
    capabilities.read,
    capabilities.submit,
    capabilities.reassign,
    capabilities.delete,
  ].map((capability) => ({
    requestId,
    capability,
    principalId: session.user.id,
    resourceId: workOrder.id,
  }));
  const decisions = await authorization.authorizeMany(relevant);
  return {
    ceiling: {
      [capabilities.read]: decisions[capabilities.read] === true,
      [capabilities.submit]:
        workOrder.status === "open" && decisions[capabilities.submit] === true,
      [capabilities.reassign]:
        workOrder.status === "open" &&
        decisions[capabilities.reassign] === true,
      [capabilities.delete]:
        workOrder.status === "open" && decisions[capabilities.delete] === true,
    },
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

function detail(
  workOrder: WorkOrder,
  authorizationEnvelope: AuthorizationEnvelope,
): WorkOrderDetail {
  return {
    ...workOrder,
    envelope: authorizationEnvelope,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("invalid_request", 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    keys.length !== sortedExpected.length ||
    keys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new DomainError("invalid_request", 400);
  }
}

function identifier(value: string): string {
  if (!/^[a-z0-9-]{1,64}$/u.test(value))
    throw new DomainError("invalid_identifier", 400);
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new DomainError("invalid_version", 400);
  return Number(value);
}

function inspectionSubmission(value: unknown): InspectionSubmission {
  const body = record(value);
  exactKeys(body, [
    "checklist",
    "expectedWorkOrderVersion",
    "idempotencyKey",
    "notes",
  ]);
  const checklist = record(body.checklist);
  exactKeys(checklist, checklistKeys);
  if (checklistKeys.some((key) => typeof checklist[key] !== "boolean")) {
    throw new DomainError("invalid_checklist", 400);
  }
  if (
    typeof body.notes !== "string" ||
    new TextEncoder().encode(body.notes).byteLength > 1_000
  ) {
    throw new DomainError("invalid_notes", 400);
  }
  if (
    typeof body.idempotencyKey !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      body.idempotencyKey,
    )
  ) {
    throw new DomainError("invalid_idempotency_key", 400);
  }
  return {
    idempotencyKey: body.idempotencyKey,
    expectedWorkOrderVersion: positiveInteger(body.expectedWorkOrderVersion),
    checklist: {
      safetyGuardSecured: checklist.safetyGuardSecured as boolean,
      fluidLevelChecked: checklist.fluidLevelChecked as boolean,
      operatingTemperatureRecorded:
        checklist.operatingTemperatureRecorded as boolean,
    },
    notes: body.notes,
  };
}

function reassignment(value: unknown): Reassignment {
  const body = record(value);
  exactKeys(body, ["expectedAssignmentEpoch", "technicianId"]);
  if (typeof body.technicianId !== "string")
    throw new DomainError("invalid_technician", 400);
  return {
    technicianId: identifier(body.technicianId),
    expectedAssignmentEpoch: positiveInteger(body.expectedAssignmentEpoch),
  };
}

function boundedText(value: unknown, code: string): string {
  if (typeof value !== "string") throw new DomainError(code, 400);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).byteLength > 80
  ) {
    throw new DomainError(code, 400);
  }
  return normalized;
}

function workOrderCreation(value: unknown): WorkOrderCreation {
  const body = record(value);
  exactKeys(body, ["equipment", "site", "technicianId"]);
  if (typeof body.technicianId !== "string") {
    throw new DomainError("invalid_technician", 400);
  }
  return {
    equipment: boundedText(body.equipment, "invalid_equipment"),
    site: boundedText(body.site, "invalid_site"),
    technicianId: identifier(body.technicianId),
  };
}

function workOrderDeletion(value: unknown): WorkOrderDeletion {
  const body = record(value);
  exactKeys(body, ["expectedAssignmentEpoch", "expectedWorkOrderVersion"]);
  return {
    expectedAssignmentEpoch: positiveInteger(body.expectedAssignmentEpoch),
    expectedWorkOrderVersion: positiveInteger(body.expectedWorkOrderVersion),
  };
}
