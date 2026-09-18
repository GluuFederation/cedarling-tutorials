import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { type Capability, capabilities } from "../shared/capabilities.ts";
import { loginHints } from "../shared/catalog.ts";
import type {
  AccessDeletion,
  AccessUpdate,
  CommentCreation,
  DocumentCreation,
  DocumentDetail,
  DocumentSummary,
  DocumentUpdate,
  Session,
} from "../shared/types.ts";
import { documentEventKinds } from "../shared/types.ts";
import type { AuthorizationPort } from "./authorization.ts";
import type { Config } from "./config.ts";
import {
  type AppDatabase,
  type AppSession,
  DomainError,
  type StoredDocument,
} from "./database.ts";
import { DocumentEvents } from "./events.ts";
import type { OidcRuntime } from "./oidc.ts";

const sessionCookie = "p7_session";
const transactionCookie = "p7_oidc";

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
  const app = Fastify({ logger: false, bodyLimit: 24 * 1024 });
  const events = new DocumentEvents();
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
  app.addHook("onClose", async () => events.close());

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
      console.error("P7 request failed", {
        requestId: request.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
    void reply.status(status).send({ error: code, requestId: request.id });
  });

  app.get("/healthz", async () => ({
    status: "ok",
    service: "p7-collaborative-docs",
  }));

  app.get<{ Querystring: { login_hint?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const hint = request.query.login_hint;
      if (!hint || !loginHints.has(hint)) {
        throw new DomainError("invalid_identity", 400);
      }
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

  app.get("/api/documents", async (request) => {
    const session = requireSession(request, dependencies.database);
    const createAllowed = await authorize(
      request.id,
      session,
      capabilities.create,
      "documents",
      { collection: true },
      dependencies.authorization,
    );
    const documents = [];
    for (const document of dependencies.database.listDocuments(
      session.user.id,
    )) {
      if (
        await authorize(
          request.id,
          session,
          capabilities.read,
          document.id,
          documentFacts(document),
          dependencies.authorization,
        )
      ) {
        documents.push(document);
      }
    }
    return { documents, createAllowed };
  });

  app.post("/api/documents", async (request, reply) => {
    const session = requireMutationSession(request, dependencies);
    const input = documentCreation(request.body);
    const allowed = await authorize(
      request.id,
      session,
      capabilities.create,
      "documents",
      { collection: true },
      dependencies.authorization,
    );
    if (!allowed) throw new DomainError("forbidden", 403);
    return reply.status(201).send({
      document: dependencies.database.createDocument(
        session.user.id,
        input.title,
        input.content,
      ),
    });
  });

  app.get<{ Params: { id: string } }>("/api/documents/:id", async (request) => {
    const session = requireSession(request, dependencies.database);
    return loadAuthorizedDocument(
      request.id,
      request.params.id,
      session,
      dependencies,
    );
  });

  app.patch<{ Params: { id: string } }>(
    "/api/documents/:id",
    async (request) => {
      const session = requireMutationSession(request, dependencies);
      const document = requireDocument(
        request.params.id,
        session.user.id,
        dependencies.database,
      );
      const input = documentUpdate(request.body);
      const allowed = await authorize(
        request.id,
        session,
        capabilities.edit,
        document.id,
        documentFacts(document),
        dependencies.authorization,
      );
      if (!allowed) throw new DomainError("forbidden", 403);
      dependencies.database.updateDocument({
        documentId: document.id,
        ...input,
      });
      await events.publish({
        documentId: document.id,
        kind: documentEventKinds.updated,
      });
      return loadAuthorizedDocument(
        request.id,
        document.id,
        session,
        dependencies,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/documents/:id/comments",
    async (request, reply) => {
      const session = requireMutationSession(request, dependencies);
      const document = requireDocument(
        request.params.id,
        session.user.id,
        dependencies.database,
      );
      const input = commentCreation(request.body);
      const allowed = await authorize(
        request.id,
        session,
        capabilities.comment,
        document.id,
        documentFacts(document),
        dependencies.authorization,
      );
      if (!allowed) throw new DomainError("forbidden", 403);
      const result = dependencies.database.addComment({
        documentId: document.id,
        principalId: session.user.id,
        ...input,
      });
      if (!result.replayed) {
        await events.publish({
          documentId: document.id,
          kind: documentEventKinds.commentCreated,
        });
      }
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.put<{ Params: { id: string; principalId: string } }>(
    "/api/documents/:id/access/:principalId",
    async (request) => {
      const session = requireMutationSession(request, dependencies);
      const document = requireDocument(
        request.params.id,
        session.user.id,
        dependencies.database,
      );
      const input = accessUpdate(request.body);
      const targetPrincipalId = identifier(request.params.principalId);
      const allowed = await authorize(
        request.id,
        session,
        capabilities.manageAccess,
        document.id,
        {
          ...documentFacts(document),
          targetPrincipalId,
          requestedRole: input.role,
        },
        dependencies.authorization,
      );
      if (!allowed) throw new DomainError("forbidden", 403);
      dependencies.database.setAccess({
        documentId: document.id,
        userId: targetPrincipalId,
        ...input,
      });
      await events.publish({
        documentId: document.id,
        kind: documentEventKinds.accessChanged,
      });
      return loadAuthorizedDocument(
        request.id,
        document.id,
        session,
        dependencies,
      );
    },
  );

  app.delete<{ Params: { id: string; principalId: string } }>(
    "/api/documents/:id/access/:principalId",
    async (request) => {
      const session = requireMutationSession(request, dependencies);
      const document = requireDocument(
        request.params.id,
        session.user.id,
        dependencies.database,
      );
      const input = accessDeletion(request.body);
      const targetPrincipalId = identifier(request.params.principalId);
      const allowed = await authorize(
        request.id,
        session,
        capabilities.manageAccess,
        document.id,
        {
          ...documentFacts(document),
          targetPrincipalId,
          operation: "revoke",
        },
        dependencies.authorization,
      );
      if (!allowed) throw new DomainError("forbidden", 403);
      dependencies.database.removeAccess({
        documentId: document.id,
        userId: targetPrincipalId,
        ...input,
      });
      await events.publish({
        documentId: document.id,
        kind: documentEventKinds.accessChanged,
      });
      return loadAuthorizedDocument(
        request.id,
        document.id,
        session,
        dependencies,
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/documents/:id/events",
    async (request, reply) => {
      const session = requireSession(request, dependencies.database);
      const sessionId = request.cookies[sessionCookie] as string;
      const document = requireDocument(
        request.params.id,
        session.user.id,
        dependencies.database,
      );
      if (
        !(await authorize(
          request.id,
          session,
          capabilities.observe,
          document.id,
          documentFacts(document),
          dependencies.authorization,
        ))
      ) {
        throw new DomainError("forbidden", 403);
      }
      if (!events.hasCapacity(document.id)) {
        throw new DomainError("stream_limit_reached", 429);
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      });
      const dispose = events.subscribe(
        document.id,
        reply.raw,
        async (event) => {
          const currentSession = dependencies.database.findSession(sessionId);
          if (!currentSession) return false;
          const current = dependencies.database.findDocument(
            document.id,
            currentSession.user.id,
          );
          return Boolean(
            current &&
              (await authorize(
                `${request.id}:${event.kind}`,
                currentSession,
                capabilities.observe,
                current.id,
                {
                  ...documentFacts(current),
                  eventKind: event.kind,
                },
                dependencies.authorization,
              )),
          );
        },
      );
      request.raw.once("close", dispose);
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

async function loadAuthorizedDocument(
  requestId: string,
  rawId: string,
  session: AppSession,
  dependencies: Dependencies,
): Promise<DocumentDetail> {
  const document = requireDocument(
    rawId,
    session.user.id,
    dependencies.database,
  );
  const requests = [
    capabilities.read,
    capabilities.edit,
    capabilities.comment,
    capabilities.manageAccess,
  ].map((capability) => ({
    requestId,
    capability,
    principalId: session.user.id,
    resourceId: document.id,
    facts: documentFacts(document),
  }));
  const decisions = await dependencies.authorization.authorizeMany(requests);
  if (!decisions[capabilities.read]) throw new DomainError("not_found", 404);
  const relations = dependencies.database.documentRelations(document.id);
  return {
    ...document,
    ...relations,
    candidates: decisions[capabilities.manageAccess]
      ? dependencies.database.listUsers()
      : [],
    actions: {
      edit: decisions[capabilities.edit] === true,
      comment: decisions[capabilities.comment] === true,
      manageAccess: decisions[capabilities.manageAccess] === true,
    },
  };
}

function requireDocument(
  rawId: string,
  viewerId: string,
  database: AppDatabase,
): StoredDocument {
  const document = database.findDocument(identifier(rawId), viewerId);
  if (!document) throw new DomainError("not_found", 404);
  return document;
}

function documentFacts(document: StoredDocument | DocumentSummary) {
  return {
    role: document.role ?? "none",
    ownerId: document.ownerId,
    documentVersion: document.documentVersion,
    accessVersion: document.accessVersion,
  };
}

function authorize(
  requestId: string,
  session: AppSession,
  capability: Capability,
  resourceId: string,
  facts: Readonly<Record<string, unknown>>,
  authorization: AuthorizationPort,
): Promise<boolean> {
  return authorization.authorize({
    requestId,
    capability,
    principalId: session.user.id,
    resourceId,
    facts,
  });
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
  const wanted = [...expected].sort();
  if (
    keys.length !== wanted.length ||
    keys.some((key, index) => key !== wanted[index])
  ) {
    throw new DomainError("invalid_request", 400);
  }
}

function identifier(value: string): string {
  if (!/^[a-z0-9-]{1,80}$/u.test(value)) {
    throw new DomainError("invalid_identifier", 400);
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new DomainError("invalid_version", 400);
  }
  return Number(value);
}

function boundedText(value: unknown, code: string, bytes: number): string {
  if (typeof value !== "string") throw new DomainError(code, 400);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).byteLength > bytes
  ) {
    throw new DomainError(code, 400);
  }
  return normalized;
}

function documentCreation(value: unknown): DocumentCreation {
  const body = record(value);
  exactKeys(body, ["content", "title"]);
  return {
    title: boundedText(body.title, "invalid_title", 100),
    content: boundedText(body.content, "invalid_content", 20_000),
  };
}

function documentUpdate(value: unknown): DocumentUpdate {
  const body = record(value);
  exactKeys(body, ["content", "expectedDocumentVersion", "title"]);
  return {
    title: boundedText(body.title, "invalid_title", 100),
    content: boundedText(body.content, "invalid_content", 20_000),
    expectedDocumentVersion: positiveInteger(body.expectedDocumentVersion),
  };
}

function commentCreation(value: unknown): CommentCreation {
  const body = record(value);
  exactKeys(body, ["body", "idempotencyKey"]);
  if (
    typeof body.idempotencyKey !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      body.idempotencyKey,
    )
  ) {
    throw new DomainError("invalid_idempotency_key", 400);
  }
  return {
    body: boundedText(body.body, "invalid_comment", 1_000),
    idempotencyKey: body.idempotencyKey,
  };
}

function accessUpdate(value: unknown): AccessUpdate {
  const body = record(value);
  exactKeys(body, ["expectedAccessVersion", "role"]);
  if (body.role !== "editor" && body.role !== "commenter") {
    throw new DomainError("invalid_role", 400);
  }
  return {
    role: body.role,
    expectedAccessVersion: positiveInteger(body.expectedAccessVersion),
  };
}

function accessDeletion(value: unknown): AccessDeletion {
  const body = record(value);
  exactKeys(body, ["expectedAccessVersion"]);
  return { expectedAccessVersion: positiveInteger(body.expectedAccessVersion) };
}
