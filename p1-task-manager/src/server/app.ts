import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import { capabilities, type Capability } from "./capabilities.js";
import { logTaskListAuthorization } from "./authorization-trace.js";
import type { AppConfig } from "./config.js";
import { safeEqual, randomToken } from "./crypto.js";
import { AppDatabase, type Session } from "./database.js";
import type { OidcRuntime } from "./oidc.js";

const sessionCookie = "p1_session";
const transactionCookie = "p1_oidc_transaction";
const versionSchema = z.object({ version: z.number().int().positive() });
const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
});
const editInputSchema = taskInputSchema.extend({
  version: z.number().int().positive(),
});
const assignInputSchema = versionSchema.extend({
  assigneeId: z.string().min(1).max(80),
});
const loginHintSchema = z.enum(["alex", "mina", "sam"]).default("alex");

function apiSchema(capability: Capability, body?: object): object {
  // Permissive metadata names the future Cedarling check; it does not enforce it.
  return {
    tags: ["tasks"],
    ...(body ? { body } : {}),
    "x-cedarling-capability": capability,
  };
}

function noCache(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}

function getSession(
  request: FastifyRequest,
  database: AppDatabase,
  config: AppConfig,
): Session | undefined {
  const rawId = request.cookies[sessionCookie];
  return rawId ? database.getSession(rawId, config) : undefined;
}

function requireMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  session: Session,
  config: AppConfig,
): boolean {
  // Request authenticity is not authorization: these checks stop cross-site
  // mutations but do not decide whether the actor may proceed.
  const csrf = request.headers["x-csrf-token"];
  const origin = request.headers.origin;
  const fetchSite = request.headers["sec-fetch-site"];
  const validFetchSite =
    !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  if (
    typeof csrf !== "string" ||
    !safeEqual(csrf, session.csrfToken) ||
    origin !== new URL(config.baseUrl).origin ||
    !validFetchSite
  ) {
    void reply.code(403).send({ error: "request_verification_failed" });
    return false;
  }
  return true;
}

function sendMutationResult(reply: FastifyReply, result: unknown): void {
  if (result === undefined) {
    void reply.code(404).send({ error: "task_not_found" });
    return;
  }
  if (result === "conflict") {
    void reply.code(409).send({ error: "stale_task_version" });
    return;
  }
  void reply.send(result === "deleted" ? { deleted: true } : { task: result });
}

export async function buildApp(
  options: Readonly<{
    config: AppConfig;
    database: AppDatabase;
    oidc: OidcRuntime;
    webRoot?: string;
  }>,
): Promise<FastifyInstance> {
  const { config, database, oidc } = options;
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 16_384 });
  const refreshes = new Map<string, Promise<Session | undefined>>();

  async function refreshSession(rawId: string): Promise<Session | undefined> {
    const current = database.getSession(rawId, config);
    if (!current || current.tokens.accessTokenExpiresAt > Date.now() + 30_000) {
      return current;
    }

    let pending = refreshes.get(rawId);
    if (!pending) {
      pending = (async () => {
        const latest = database.getSession(rawId, config);
        if (
          !latest ||
          latest.tokens.accessTokenExpiresAt > Date.now() + 30_000
        ) {
          return latest;
        }
        const tokens = await oidc.refresh(latest.tokens);
        database.updateSessionTokens(rawId, tokens, config);
        return { ...latest, tokens };
      })();
      refreshes.set(rawId, pending);
    }

    try {
      return await pending;
    } finally {
      if (refreshes.get(rawId) === pending) refreshes.delete(rawId);
    }
  }

  async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Session | undefined> {
    const rawId = request.cookies[sessionCookie];
    if (!rawId) {
      void reply.code(401).send({ error: "authentication_required" });
      return undefined;
    }
    try {
      const session = await refreshSession(rawId);
      if (session) return session;
    } catch {
      database.deleteSession(rawId);
    }
    reply.clearCookie(sessionCookie, { path: "/" });
    void reply.code(401).send({ error: "authentication_required" });
    return undefined;
  }

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
  await app.register(swagger, {
    openapi: {
      info: { title: "P1 Task Manager API", version: "0.0.1" },
      servers: [{ url: config.baseUrl }],
    },
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/openapi.json", async (_request, reply) =>
    reply.send(app.swagger()),
  );

  app.get<{ Querystring: { login_hint?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const loginHint = loginHintSchema.safeParse(request.query.login_hint);
      if (!loginHint.success) {
        return reply.code(400).send({ error: "invalid_tutorial_login_hint" });
      }
      const rawId = randomToken();
      const transaction = {
        state: randomToken(),
        nonce: randomToken(),
        verifier: randomToken(48),
      };
      database.createTransaction({
        rawId,
        ...transaction,
        expiresAt: Date.now() + 300_000,
      });
      reply.setCookie(transactionCookie, rawId, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.baseUrl.startsWith("https:"),
        path: "/auth/callback",
        maxAge: 300,
      });
      return reply.redirect(
        (await oidc.authorizationUrl(transaction, loginHint.data)).toString(),
      );
    },
  );

  app.get("/auth/callback", async (request, reply) => {
    noCache(reply);
    const rawId = request.cookies[transactionCookie];
    const transaction = rawId ? database.consumeTransaction(rawId) : undefined;
    reply.clearCookie(transactionCookie, { path: "/auth/callback" });
    if (!transaction)
      return reply
        .code(400)
        .send({ error: "invalid_or_expired_login_transaction" });

    try {
      const identity = await oidc.exchange(
        new URL(request.url, config.baseUrl),
        transaction,
      );
      const user = database.findUser(identity.issuer, identity.subject);
      if (!user)
        return reply.code(403).send({ error: "unmapped_tutorial_identity" });
      const session = database.createSession(user.id, identity.tokens, config);
      reply.setCookie(sessionCookie, session.rawId, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.baseUrl.startsWith("https:"),
        path: "/",
        maxAge: 1_200,
      });
      return reply.redirect("/");
    } catch {
      return reply.code(400).send({ error: "login_callback_rejected" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const session = getSession(request, database, config);
    if (!session || !requireMutation(request, reply, session, config)) return;
    const rawId = request.cookies[sessionCookie];
    if (rawId) database.deleteSession(rawId);
    reply.clearCookie(sessionCookie, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/session", async (request, reply) => {
    noCache(reply);
    const session = await requireSession(request, reply);
    if (!session) return;
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        tenantId: session.user.tenantId,
        role: session.user.role,
        assuranceLevel: session.user.assuranceLevel,
      },
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  });

  app.get(
    "/api/tasks",
    { schema: apiSchema(capabilities.view) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      // Normal navigation stays tenant-scoped so the direct task routes remain
      // the single authorization gap learners can isolate.
      const tasks = database.listTasks(session.user.tenantId);
      logTaskListAuthorization({
        principalId: session.user.id,
        tenantId: session.user.tenantId,
      });
      return { tasks };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/tasks/:id",
    { schema: apiSchema(capabilities.view) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return;
      // Authentication succeeds, but task.view is not
      // evaluated until Cedarling is introduced in the next tutorial phase.
      const task = database.getTask(request.params.id);
      return task
        ? { task }
        : reply.code(404).send({ error: "task_not_found" });
    },
  );

  // Direct effect handlers intentionally pass no actor to the database.
  // Cedarling will be inserted immediately before each effect in the next phase.
  app.post(
    "/api/tasks",
    { schema: apiSchema(capabilities.create) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session || !requireMutation(request, reply, session, config)) return;
      const parsed = taskInputSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "invalid_task",
          details: z.flattenError(parsed.error).fieldErrors,
        });
      const task = database.createTask(
        session.user,
        parsed.data.title,
        parsed.data.description,
      );
      return reply.code(201).send({
        task,
      });
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/tasks/:id",
    { schema: apiSchema(capabilities.edit) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session || !requireMutation(request, reply, session, config)) return;
      const parsed = editInputSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_task" });
      sendMutationResult(
        reply,
        database.editTask(
          request.params.id,
          parsed.data.version,
          parsed.data.title,
          parsed.data.description,
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/assign",
    { schema: apiSchema(capabilities.assign) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session || !requireMutation(request, reply, session, config)) return;
      const parsed = assignInputSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_assignment" });
      sendMutationResult(
        reply,
        database.assignTask(
          request.params.id,
          parsed.data.version,
          parsed.data.assigneeId,
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/complete",
    { schema: apiSchema(capabilities.complete) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session || !requireMutation(request, reply, session, config)) return;
      const parsed = versionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_task_version" });
      sendMutationResult(
        reply,
        database.completeTask(request.params.id, parsed.data.version),
      );
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/tasks/:id",
    { schema: apiSchema(capabilities.delete) },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session || !requireMutation(request, reply, session, config)) return;
      const parsed = versionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid_task_version" });
      sendMutationResult(
        reply,
        database.deleteTask(request.params.id, parsed.data.version),
      );
    },
  );

  const webRoot = options.webRoot ?? path.resolve(process.cwd(), "dist/web");
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.addHook("onClose", async () => database.close());
  return app;
}
