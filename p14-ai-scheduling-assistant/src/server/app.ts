import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { loginHints } from "../shared/catalog.ts";
import type { SessionView } from "../shared/types.ts";
import type { Config } from "./config.ts";
import type { AppDatabase, Session } from "./database.ts";
import { AppError } from "./errors.ts";
import type { OidcRuntime } from "./oidc.ts";
import type { SchedulingService } from "./service.ts";

const sessionCookie = "p14_session";
const transactionCookie = "p14_oidc";

type Dependencies = Readonly<{
  config: Config;
  database: AppDatabase;
  oidc: OidcRuntime;
  service: SchedulingService;
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
    const domain = error instanceof AppError ? error : undefined;
    const reported =
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const status =
      domain?.status ?? (reported && reported < 500 ? reported : 500);
    const code =
      domain?.code ??
      (status < 500 ? "INVALID_REQUEST" : "SERVICE_UNAVAILABLE");
    if (status >= 500)
      console.error("P14 request failed", {
        requestId: request.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    void reply.status(status).send({
      error: code,
      message: status < 500 ? domain?.message : undefined,
      requestId: request.id,
    });
  });

  app.get("/healthz", async () => ({
    status: "ok",
    service: "p14-ai-scheduling-assistant",
  }));

  app.get<{ Querystring: { login_hint?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const hint = request.query.login_hint;
      if (!hint || !loginHints.has(hint))
        throw new AppError("INVALID_IDENTITY", 400);
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
    if (!raw) throw new AppError("INVALID_LOGIN_TRANSACTION", 400);
    const transaction = dependencies.database.consumeLoginTransaction(raw);
    reply.clearCookie(transactionCookie, cookieOptions(dependencies.config));
    if (!transaction) throw new AppError("INVALID_LOGIN_TRANSACTION", 400);
    const identity = await dependencies.oidc.exchange(
      new URL(request.raw.url ?? "/auth/callback", dependencies.config.baseUrl),
      transaction,
    );
    const user = dependencies.database.findUser(identity.subject);
    if (!user) throw new AppError("UNMAPPED_IDENTITY", 403);
    const created = dependencies.database.createSession(
      user.id,
      identity.accessToken,
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
    requireMutation(request, dependencies);
    const raw = request.cookies[sessionCookie];
    if (raw) dependencies.database.deleteSession(raw);
    reply.clearCookie(sessionCookie, cookieOptions(dependencies.config));
    return reply.status(204).send();
  });

  app.get("/api/session", async (request): Promise<SessionView> => {
    const raw = request.cookies[sessionCookie];
    const session = raw ? dependencies.database.getSession(raw) : undefined;
    return session
      ? {
          authenticated: true,
          user: session.user,
          csrfToken: session.csrfToken,
        }
      : { authenticated: false };
  });

  app.get("/api/workspace", async (request) => {
    const session = requireSession(request, dependencies.database);
    return dependencies.service.workspace(session, request.id);
  });

  app.post("/api/assistant/proposals", async (request, reply) => {
    const session = requireMutation(request, dependencies);
    const input = proposalInput(request.body);
    const proposal = await dependencies.service.propose(
      session,
      input,
      request.id,
    );
    return reply.status(201).send({ proposal });
  });

  app.post<{ Params: { id: string } }>(
    "/api/assistant/proposals/:id/execute",
    async (request) => {
      const session = requireMutation(request, dependencies);
      const input = executionInput(request.body);
      return {
        result: await dependencies.service.execute(
          session,
          request.params.id,
          input.proposalVersion,
          request.id,
        ),
      };
    },
  );

  if (dependencies.serveWeb !== false) {
    await app.register(staticPlugin, {
      root: resolve("dist/web"),
      wildcard: false,
    });
  }
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({ error: "NOT_FOUND", requestId: request.id });
  });
  return app;
}

function requireSession(
  request: FastifyRequest,
  database: AppDatabase,
): Session {
  const raw = request.cookies[sessionCookie];
  const session = raw ? database.getSession(raw) : undefined;
  if (!session) throw new AppError("AUTHENTICATION_REQUIRED", 401);
  return session;
}

function requireMutation(
  request: FastifyRequest,
  dependencies: Dependencies,
): Session {
  const session = requireSession(request, dependencies.database);
  if (
    request.headers.origin !== dependencies.config.baseUrl ||
    (request.headers["sec-fetch-site"] &&
      request.headers["sec-fetch-site"] !== "same-origin") ||
    request.headers["x-csrf-token"] !== session.csrfToken
  )
    throw new AppError("REQUEST_INTEGRITY_REQUIRED", 403);
  return session;
}

function proposalInput(value: unknown): {
  requestId: string;
  meetingId?: string;
} {
  const body = exactObject(value, ["requestId"], ["meetingId"]);
  if (typeof body.requestId !== "string" || body.requestId.length > 100)
    throw new AppError("INVALID_REQUEST", 400);
  if (
    body.meetingId !== undefined &&
    (typeof body.meetingId !== "string" || body.meetingId.length > 100)
  )
    throw new AppError("INVALID_REQUEST", 400);
  return {
    requestId: body.requestId,
    ...(typeof body.meetingId === "string"
      ? { meetingId: body.meetingId }
      : {}),
  };
}

function executionInput(value: unknown): { proposalVersion: number } {
  const body = exactObject(value, ["confirmed", "proposalVersion"]);
  if (
    body.confirmed !== true ||
    !Number.isSafeInteger(body.proposalVersion) ||
    Number(body.proposalVersion) < 1
  )
    throw new AppError("INVALID_REQUEST", 400);
  return { proposalVersion: Number(body.proposalVersion) };
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_REQUEST", 400);
  const body = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(body, key)) ||
    Object.keys(body).some((key) => !allowed.has(key))
  )
    throw new AppError("INVALID_REQUEST", 400);
  return body;
}

function cookieOptions(config: Config, maxAge?: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.baseUrl.startsWith("https:"),
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}
