import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import type {
  ExportCreated,
  QueryPlan,
  QueryResponse,
} from "../shared/contracts.ts";
import type { DataAuthorization } from "./authorization.ts";
import type { AppConfig } from "./config.ts";
import { randomToken, safeEqual } from "./crypto.ts";
import type { AppDatabase, Session } from "./database.ts";
import { AuthorizationError } from "./errors.ts";
import type { ExportService } from "./export-service.ts";
import type { OidcRuntime } from "./oidc.ts";
import {
  compileCardinalityQuery,
  compileQuery,
  queryPlanSchema,
} from "./query.ts";

const sessionCookie = "p5_session";
const transactionCookie = "p5_oidc_transaction";
const loginHintSchema = z.enum(["amina", "leah", "theo"]);
const exportIdSchema = z.string().uuid();
const exportReferenceSchema = z
  .object({ downloadRef: z.string().min(32).max(128) })
  .strict();
const previewSchema = z
  .object({
    queryPlan: queryPlanSchema,
    exportPlan: queryPlanSchema.optional(),
    exportId: exportIdSchema.optional(),
  })
  .strict();

function noStore(context: Context): void {
  context.header("cache-control", "private, no-store");
}

function requireActiveRequest(context: Context): void {
  if (context.req.raw.signal.aborted)
    throw new HTTPException(400, {
      res: context.json(
        { error: "request_cancelled", requestId: context.get("requestId") },
        400,
      ),
    });
}

function acceptsJsonBody(context: Context): boolean {
  return (
    context.req
      .header("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
}

function publicUser(session: Session) {
  return {
    id: session.user.id,
    name: session.user.name,
    tenantId: session.user.tenantId,
    role: session.user.role,
  };
}

function requireMutation(
  context: Context,
  session: Session,
  config: AppConfig,
): boolean {
  // Request authenticity is independent of the authorization decision.
  const csrf = context.req.header("x-csrf-token");
  const origin = context.req.header("origin");
  const fetchSite = context.req.header("sec-fetch-site");
  const fetchSiteValid =
    !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  return Boolean(
    csrf &&
      safeEqual(csrf, session.csrfToken) &&
      origin === new URL(config.baseUrl).origin &&
      fetchSiteValid,
  );
}

export function buildApp(
  options: Readonly<{
    config: AppConfig;
    database: AppDatabase;
    oidc: OidcRuntime;
    exports: ExportService;
    authorization: DataAuthorization;
    webRoot?: string;
  }>,
): Hono {
  const { config, database, oidc, exports, authorization, webRoot } = options;
  const app = new Hono();
  const refreshes = new Map<string, Promise<Session | undefined>>();
  // Record effects only after their transaction succeeds; never log result values.
  function logEvent(
    context: Context,
    event: string,
    details: {
      resultCount?: number;
      exportId?: string;
      category?: string;
      httpStatus?: number;
    } = {},
  ) {
    console.info(
      JSON.stringify(
        {
          event,
          requestId: context.get("requestId"),
          actorId: context.get("actorId"),
          ...details,
        },
        null,
        2,
      ),
    );
  }
  function cleanupExports(context: Context): void {
    try {
      database.cleanupExports();
    } catch {
      // The lifecycle transition is committed; downloads remain blocked.
      console.warn(
        JSON.stringify(
          {
            event: "export.cleanup.deferred",
            requestId: context.get("requestId"),
          },
          null,
          2,
        ),
      );
    }
  }
  app.use("/api/*", requestId({ limitLength: 0 }));
  app.use("/api/*", async (context, next) => {
    noStore(context);
    await next();
    if (context.res.status >= 400) {
      // These are controlled API error codes, not exception messages or request bodies.
      const body = (await context.res
        .clone()
        .json()
        .catch(() => ({}))) as { error?: string };
      logEvent(context, "request.failed", {
        httpStatus: context.res.status,
        category: body.error ?? "request_failed",
      });
    }
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (context) => context.json({ error: "request_too_large" }, 413),
    }),
  );

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
    context: Context,
  ): Promise<Session | undefined> {
    const rawId = getCookie(context, sessionCookie);
    if (!rawId) return undefined;
    try {
      const session = await refreshSession(rawId);
      if (session) context.set("actorId", session.user.id);
      return session;
    } catch {
      database.deleteSession(rawId);
      deleteCookie(context, sessionCookie, { path: "/" });
      return undefined;
    }
  }

  async function executePlan<T>(
    context: Context,
    plan: QueryPlan,
    capability: "data.query" | "data.aggregate" | "data.export",
    session: Session,
    requestId: string,
    effect: (columns: string[], rows: QueryResponse["rows"]) => T,
  ): Promise<T> {
    requireActiveRequest(context);
    const { cardinality, minimumGroupSize } = planFacts(plan);
    if (
      !(await authorization.authorize({
        requestId,
        analyst: session.user,
        capability,
        plan,
        ...(minimumGroupSize !== undefined ? { minimumGroupSize } : {}),
      }))
    )
      throw new AuthorizationError(403, "authorization_denied");
    return database.withCurrentSession(
      getCookie(context, sessionCookie) ?? "",
      config,
      session,
      () => {
        // Only the bounded cardinality probe precedes ALLOW; protected values do not.
        requireActiveRequest(context);
        if (
          cardinality &&
          database.minimumGroupSize(cardinality) !== minimumGroupSize
        )
          throw new AuthorizationError(409, "authorization_state_changed");
        const compiled = compileQuery(plan);
        return effect(compiled.outputColumns, database.execute(compiled));
      },
    );
  }

  // The same bounded metadata probe feeds previews and execution-time policy checks.
  function planFacts(plan: QueryPlan) {
    const cardinality =
      plan.kind === "aggregate" ? compileCardinalityQuery(plan) : undefined;
    return {
      cardinality,
      minimumGroupSize: cardinality
        ? database.minimumGroupSize(cardinality)
        : undefined,
    };
  }

  app.post("/api/authorization", async (context) => {
    const session = await requireSession(context);
    if (!session)
      return context.json({ error: "authentication_required" }, 401);
    if (!requireMutation(context, session, config))
      return context.json({ error: "request_verification_failed" }, 403);
    if (!acceptsJsonBody(context))
      return context.json({ error: "unsupported_media_type" }, 415);
    const parsed = previewSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return context.json({ error: "invalid_query_plan" }, 400);
    requireActiveRequest(context);
    const requestId = context.get("requestId") as string;
    const base = {
      requestId,
      analyst: session.user,
      phase: "preview" as const,
    };
    async function planAllowed(
      plan: QueryPlan,
      capability: "data.query" | "data.aggregate" | "data.export",
    ) {
      requireActiveRequest(context);
      const { minimumGroupSize } = planFacts(plan);
      return authorization.authorize({
        ...base,
        capability,
        plan,
        ...(minimumGroupSize !== undefined ? { minimumGroupSize } : {}),
      });
    }
    const { queryPlan, exportPlan, exportId } = parsed.data;
    const query = await planAllowed(
      queryPlan,
      queryPlan.kind === "rows" ? "data.query" : "data.aggregate",
    );
    const createExport = exportPlan
      ? await planAllowed(exportPlan, "data.export")
      : false;
    const record = exportId ? database.exportMetadata(exportId) : undefined;
    // Missing and other users' exports produce the same bounded UI response.
    const ready =
      record?.ownerId === session.user.id &&
      record.state === "ready" &&
      Date.parse(record.expiresAt) > Date.now();
    const download =
      ready &&
      (await authorization.authorize({
        ...base,
        capability: "export.download",
        export: record,
      }));
    const revoke =
      ready &&
      (await authorization.authorize({
        ...base,
        capability: "export.revoke",
        export: record,
      }));
    return database.withCurrentSession(
      getCookie(context, sessionCookie) ?? "",
      config,
      session,
      () => {
        requireActiveRequest(context);
        return context.json({
          requestId,
          query,
          createExport,
          download,
          revoke,
        });
      },
    );
  });

  app.get("/health", (context) =>
    context.json({ status: "ok", service: "p5-dataguard" }),
  );

  app.get("/auth/login", async (context) => {
    const loginHint = loginHintSchema.safeParse(
      context.req.query("login_hint"),
    );
    if (!loginHint.success) {
      return context.json({ error: "invalid_tutorial_login_hint" }, 400);
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
    setCookie(context, transactionCookie, rawId, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.baseUrl.startsWith("https:"),
      path: "/auth/callback",
      maxAge: 300,
    });
    return context.redirect(
      (await oidc.authorizationUrl(transaction, loginHint.data)).toString(),
    );
  });

  app.get("/auth/callback", async (context) => {
    noStore(context);
    const rawId = getCookie(context, transactionCookie);
    const transaction = rawId ? database.consumeTransaction(rawId) : undefined;
    deleteCookie(context, transactionCookie, { path: "/auth/callback" });
    if (!transaction) {
      return context.json(
        { error: "invalid_or_expired_login_transaction" },
        400,
      );
    }
    try {
      const identity = await oidc.exchange(
        new URL(context.req.url),
        transaction,
      );
      const analyst = database.findAnalyst(identity.issuer, identity.subject);
      if (!analyst) {
        return context.json({ error: "unmapped_tutorial_identity" }, 403);
      }
      const session = database.createSession(
        analyst.id,
        identity.tokens,
        config,
      );
      setCookie(context, sessionCookie, session.rawId, {
        httpOnly: true,
        sameSite: "Lax",
        secure: config.baseUrl.startsWith("https:"),
        path: "/",
        maxAge: 1_800,
      });
      return context.redirect("/");
    } catch {
      return context.json({ error: "login_callback_rejected" }, 400);
    }
  });

  app.post("/auth/logout", async (context) => {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    if (!requireMutation(context, session, config)) {
      return context.json({ error: "request_verification_failed" }, 403);
    }
    const rawId = getCookie(context, sessionCookie);
    if (rawId) database.deleteSession(rawId);
    deleteCookie(context, sessionCookie, { path: "/" });
    return context.body(null, 204);
  });

  app.get("/api/session", async (context) => {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    return context.json({
      user: publicUser(session),
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  app.get("/api/dataset", async (context) => {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    const requestId = context.get("requestId") as string;
    requireActiveRequest(context);
    const fields = await authorization.inspect(requestId, session.user);
    if (fields.length === 0)
      throw new AuthorizationError(403, "authorization_denied");
    return database.withCurrentSession(
      getCookie(context, sessionCookie) ?? "",
      config,
      session,
      () => {
        requireActiveRequest(context);
        return context.json({
          requestId,
          dataset: {
            id: "workforce",
            fields,
          },
        });
      },
    );
  });

  async function executeQuery(
    context: Context,
    expectedKind: "rows" | "aggregate",
  ) {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    if (!requireMutation(context, session, config)) {
      return context.json({ error: "request_verification_failed" }, 403);
    }
    if (!acceptsJsonBody(context)) {
      return context.json({ error: "unsupported_media_type" }, 415);
    }
    const body = await context.req.json().catch(() => undefined);
    const parsed = queryPlanSchema.safeParse(body);
    if (!parsed.success || parsed.data.kind !== expectedKind) {
      return context.json({ error: "invalid_query_plan" }, 400);
    }
    const requestId = context.get("requestId") as string;
    try {
      const result = await executePlan(
        context,
        parsed.data,
        expectedKind === "rows" ? "data.query" : "data.aggregate",
        session,
        requestId,
        (columns, rows) => ({ requestId, columns, rows }),
      );
      logEvent(
        context,
        expectedKind === "rows"
          ? "data.query.completed"
          : "data.aggregate.completed",
        { resultCount: result.rows.length },
      );
      return context.json(result);
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof HTTPException)
        throw error;
      return context.json({ error: "database_unavailable", requestId }, 503);
    }
  }

  app.post("/api/query/rows", (context) => executeQuery(context, "rows"));
  app.post("/api/query/aggregate", (context) =>
    executeQuery(context, "aggregate"),
  );

  app.post("/api/exports", async (context) => {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    if (!requireMutation(context, session, config)) {
      return context.json({ error: "request_verification_failed" }, 403);
    }
    if (!acceptsJsonBody(context)) {
      return context.json({ error: "unsupported_media_type" }, 415);
    }
    const parsed = queryPlanSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json({ error: "invalid_query_plan" }, 400);
    }
    const requestId = context.get("requestId") as string;
    let created: ExportCreated | undefined;
    try {
      await executePlan(
        context,
        parsed.data,
        "data.export",
        session,
        requestId,
        (columns, rows) => {
          created = exports.create(session.user.id, parsed.data, columns, rows);
        },
      );
    } catch (error) {
      if (created) exports.remove(created.export.id);
      if (error instanceof AuthorizationError || error instanceof HTTPException)
        throw error;
      return context.json({ error: "export_unavailable", requestId }, 503);
    }
    if (created)
      logEvent(context, "export.created", {
        exportId: created.export.id,
        resultCount: created.export.rowCount,
      });
    return context.json({ requestId, ...created }, 201);
  });

  app.post("/api/exports/:id/revoke", async (context) => {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    if (!requireMutation(context, session, config)) {
      return context.json({ error: "request_verification_failed" }, 403);
    }
    const exportId = exportIdSchema.safeParse(context.req.param("id"));
    if (!exportId.success) {
      return context.json({ error: "invalid_export_id" }, 400);
    }
    requireActiveRequest(context);
    const current = database.getExportById(exportId.data);
    if (!current) {
      return context.json({ error: "export_not_found" }, 404);
    }
    const requestId = context.get("requestId") as string;
    if (
      !(await authorization.authorize({
        requestId,
        capability: "export.revoke",
        analyst: session.user,
        export: current,
      }))
    )
      throw new AuthorizationError(403, "authorization_denied");
    const value = database.withCurrentSession(
      getCookie(context, sessionCookie) ?? "",
      config,
      session,
      () => {
        requireActiveRequest(context);
        database.assertExport(current);
        const value = database.revokeExport(current.id);
        if (!value) throw new Error("Export disappeared during revocation");
        return value;
      },
    );
    cleanupExports(context);
    logEvent(context, "export.revoked", { exportId: value.id });
    return context.json({ export: value, requestId });
  });

  app.post("/api/exports/download", async (context) => {
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    if (!requireMutation(context, session, config)) {
      return context.json({ error: "request_verification_failed" }, 403);
    }
    if (!acceptsJsonBody(context)) {
      return context.json({ error: "unsupported_media_type" }, 415);
    }
    const parsed = exportReferenceSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return context.json({ error: "invalid_download_reference" }, 400);
    }
    requireActiveRequest(context);
    const current = database.getExportByReference(parsed.data.downloadRef);
    if (!current) {
      return context.json({ error: "export_not_found" }, 404);
    }
    if (current.state === "expired" || current.state === "revoked") {
      cleanupExports(context);
      return context.json({ error: `export_${current.state}` }, 410);
    }
    if (!current.filePath)
      return context.json({ error: "export_expired" }, 410);
    const requestId = context.get("requestId") as string;
    if (
      !(await authorization.authorize({
        requestId,
        capability: "export.download",
        analyst: session.user,
        export: current,
      }))
    )
      throw new AuthorizationError(403, "authorization_denied");
    const filePath = current.filePath;
    const bytes = database.withCurrentSession(
      getCookie(context, sessionCookie) ?? "",
      config,
      session,
      () => {
        requireActiveRequest(context);
        database.assertExport(current);
        return exports.read(filePath);
      },
    );
    context.header("content-type", "text/csv; charset=utf-8");
    context.header(
      "content-disposition",
      `attachment; filename="dataguard-${current.id}.csv"`,
    );
    const response = context.body(Uint8Array.from(bytes).buffer);
    logEvent(context, "export.download.prepared", { exportId: current.id });
    return response;
  });

  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();
    const requestId = context.get("requestId") as string | undefined;
    if (error instanceof AuthorizationError)
      return context.json({ error: error.code, requestId }, error.status);
    return context.json({ error: "internal_error", requestId }, 500);
  });

  app.all("/api/*", (context) =>
    context.json({ error: "route_not_found" }, 404),
  );
  app.all("/auth/*", (context) =>
    context.json({ error: "route_not_found" }, 404),
  );

  if (webRoot && existsSync(webRoot)) {
    app.use("/assets/*", serveStatic({ root: webRoot }));
    app.get("/favicon.ico", (context) => context.body(null, 204));
    app.get("*", serveStatic({ root: webRoot, path: "index.html" }));
  }

  return app;
}
