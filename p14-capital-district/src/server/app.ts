import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { GameCommand } from "../shared/contracts.ts";
import { ACCOUNTS, validIdempotencyKey } from "../shared/rules.ts";
import type { AuthStore } from "./auth/auth-store.ts";
import type { OidcRuntime } from "./auth/oidc.ts";
import type { Config } from "./config/environment.ts";
import { DomainError, type GameService } from "./game/service.ts";
import { HttpError } from "./http/errors.ts";
import {
  actorFor,
  cookieOptions,
  requireMutation,
  requireSession,
  sessionCookie,
  transactionCookie,
} from "./http/session.ts";
import { MatchStreams } from "./http/streams.ts";

export type Dependencies = {
  config: Config;
  auth: AuthStore;
  oidc: OidcRuntime;
  service: GameService;
  serveWeb?: boolean;
  development?: boolean;
};

export async function createApp(
  dependencies: Dependencies,
): Promise<FastifyInstance> {
  const { config, auth, oidc, service } = dependencies;
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024,
    requestTimeout: 15_000,
  });
  const streams = new MatchStreams(auth, (id) => service.get(id));
  const rates = new Map<string, { until: number; count: number }>();
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: dependencies.development
          ? ["'self'", "'unsafe-inline'"]
          : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: dependencies.development ? ["'self'", "ws:"] : ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
      },
    },
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    if (request.url.startsWith("/api/") || request.url.startsWith("/auth/"))
      reply.header("cache-control", "no-store");
  });
  app.addHook("preClose", async () => streams.close());
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof HttpError || error instanceof DomainError;
    const status = known
      ? error.status
      : typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number" &&
          error.statusCode >= 400 &&
          error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status >= 500)
      console.error(
        `P14 request failed | ${request.id} | ${error instanceof Error ? error.name : "UnknownError"}`,
      );
    void reply.status(status).send({
      error: known
        ? error.code
        : status < 500
          ? "invalid_request"
          : "service_unavailable",
      message: known
        ? error.message
        : status < 500
          ? "Check the request and try again."
          : "The game is temporarily unavailable.",
      requestId: request.id,
    });
  });

  app.get("/healthz", async () => ({
    service: "p14-capital-district",
    status: "ok",
  }));
  app.get<{ Querystring: { login_hint?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const hint = request.query.login_hint;
      if (!ACCOUNTS.some((account) => account.id === hint))
        throw new HttpError(
          "invalid_identity",
          400,
          "Choose one of the four player accounts.",
        );
      const transaction = auth.createLoginTransaction();
      const url = await oidc.authorizationUrl(transaction, hint as string);
      reply.setCookie(
        transactionCookie,
        transaction.id,
        cookieOptions(config, 120),
      );
      return reply.redirect(url.toString());
    },
  );
  app.get("/auth/callback", async (request, reply) => {
    const raw = request.cookies[transactionCookie];
    const transaction = raw ? auth.consumeLoginTransaction(raw) : undefined;
    reply.clearCookie(transactionCookie, cookieOptions(config));
    if (!transaction)
      throw new HttpError(
        "invalid_login_transaction",
        400,
        "Start sign-in again.",
      );
    const identity = await oidc.exchange(
      new URL(request.raw.url ?? "/auth/callback", config.baseUrl),
      transaction,
    );
    const user = auth.findUser(identity.subject);
    if (!user)
      throw new HttpError(
        "unmapped_identity",
        403,
        "Choose one of the four player accounts.",
      );
    const previous = request.cookies[sessionCookie];
    if (previous) {
      const session = auth.getSession(previous);
      auth.deleteSession(previous);
      if (session) streams.closeSession(session.idHash);
    }
    const created = auth.createSession(
      user.id,
      identity.accessToken,
      identity.expiresAt,
    );
    reply.setCookie(
      sessionCookie,
      created.id,
      cookieOptions(
        config,
        Math.max(
          1,
          Math.floor(
            (Math.min(identity.expiresAt, Date.now() + 30 * 60_000) -
              Date.now()) /
              1000,
          ),
        ),
      ),
    );
    return reply.redirect("/");
  });
  app.post("/auth/logout", async (request, reply) => {
    const session = requireMutation(request, auth, config);
    const raw = request.cookies[sessionCookie];
    if (raw) auth.deleteSession(raw);
    streams.closeSession(session.idHash);
    reply.clearCookie(sessionCookie, cookieOptions(config));
    return reply.status(204).send();
  });
  app.get("/api/session", async (request) => {
    const raw = request.cookies[sessionCookie];
    const session = raw ? auth.getSession(raw) : undefined;
    return session
      ? { user: session.user, csrfToken: session.csrfToken }
      : { user: null };
  });
  app.get("/api/matches", async (request) => {
    requireSession(request, auth);
    return service.list();
  });
  app.get<{ Params: { id: string } }>("/api/matches/:id", async (request) => {
    requireSession(request, auth);
    return service.get(request.params.id);
  });
  app.post("/api/matches", async (request) => {
    const session = mutation(request);
    const body = objectBody(request.body);
    if (
      Object.keys(body).some((key) => key !== "name" && key !== "preset") ||
      typeof body.name !== "string" ||
      !["normal", "practice"].includes(String(body.preset))
    )
      throw new HttpError(
        "invalid_request",
        400,
        "Provide a match name and starting position.",
      );
    return service.create(
      actorFor(session, auth),
      { name: body.name, preset: body.preset as "normal" | "practice" },
      commandKey(request),
      request.id,
    );
  });
  app.post<{ Params: { id: string } }>(
    "/api/matches/:id/commands",
    async (request) => {
      const session = mutation(request);
      const body = objectBody(request.body);
      const result = await service.execute(
        actorFor(session, auth),
        request.params.id,
        body as unknown as GameCommand,
        commandKey(request),
        request.id,
      );
      streams.publish(request.params.id);
      return result;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/matches/:id/events",
    async (request, reply) => {
      const session = requireSession(request, auth);
      if (
        (request.headers.origin && request.headers.origin !== config.baseUrl) ||
        (request.headers["sec-fetch-site"] &&
          request.headers["sec-fetch-site"] !== "same-origin")
      )
        throw new HttpError(
          "request_integrity_required",
          403,
          "Open this match from its application page.",
        );
      streams.open(reply, session, request.params.id);
    },
  );

  if (dependencies.serveWeb !== false) {
    if (dependencies.development) {
      const { createServer } = await import("vite");
      const vite = await createServer({
        configLoader: "native",
        server: { middlewareMode: true, hmr: { server: app.server } },
        appType: "spa",
      });
      app.addHook("onRequest", (request, reply, done) => {
        if (
          request.url.startsWith("/api/") ||
          request.url.startsWith("/auth/") ||
          request.url === "/healthz"
        ) {
          done();
          return;
        }
        vite.middlewares(request.raw, reply.raw, (error?: unknown) =>
          done(error instanceof Error ? error : undefined),
        );
      });
      app.addHook("preClose", async () => vite.close());
    } else {
      await app.register(staticPlugin, {
        root: resolve("dist/web"),
        wildcard: true,
      });
    }
  }
  app.setNotFoundHandler((request, reply) => {
    if (
      dependencies.serveWeb !== false &&
      !dependencies.development &&
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      !request.url.startsWith("/auth/") &&
      !request.url.includes(".")
    )
      return reply.sendFile("index.html");
    return reply
      .status(404)
      .send({ error: "not_found", requestId: request.id });
  });
  return app;

  function mutation(request: FastifyRequest) {
    const session = requireMutation(request, auth, config);
    const now = Date.now();
    if (rates.size >= 256)
      for (const [key, rate] of rates) if (rate.until <= now) rates.delete(key);
    const rate = rates.get(session.idHash);
    if (!rate || rate.until <= now)
      rates.set(session.idHash, { until: now + 1_000, count: 1 });
    else if (++rate.count > 30)
      throw new HttpError(
        "too_many_commands",
        429,
        "Wait a moment before trying again.",
      );
    return session;
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError("invalid_request", 400, "Provide a JSON object.");
  return value as Record<string, unknown>;
}

function commandKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (!validIdempotencyKey(key))
    throw new HttpError(
      "invalid_idempotency_key",
      400,
      "Provide an Idempotency-Key of 8 to 100 letters, numbers, underscores or hyphens.",
    );
  return key;
}
