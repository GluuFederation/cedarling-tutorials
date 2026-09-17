import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import type { QueryPlan } from "../shared/contracts.ts";
import type { AppConfig } from "./config.ts";
import { randomToken, safeEqual } from "./crypto.ts";
import type { AppDatabase, Session } from "./database.ts";
import type { ExportService } from "./export-service.ts";
import type { OidcRuntime } from "./oidc.ts";
import { type Capability, logPermissiveTrace } from "./permissive-trace.ts";
import {
  compileCardinalityQuery,
  compileQuery,
  datasetFields,
  queryPlanSchema,
} from "./query.ts";

const sessionCookie = "p5_session";
const transactionCookie = "p5_oidc_transaction";
const loginHintSchema = z.enum(["amina", "leah", "theo"]);
const exportIdSchema = z.string().uuid();
const exportReferenceSchema = z
  .object({ downloadRef: z.string().min(32).max(128) })
  .strict();

function noStore(context: Context): void {
  context.header("cache-control", "private, no-store");
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
  // Request authenticity is independent of the future authorization decision.
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
    webRoot?: string;
  }>,
): Hono {
  const { config, database, oidc, exports, webRoot } = options;
  const app = new Hono();
  const refreshes = new Map<string, Promise<Session | undefined>>();

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
      return await refreshSession(rawId);
    } catch {
      database.deleteSession(rawId);
      deleteCookie(context, sessionCookie, { path: "/" });
      return undefined;
    }
  }

  function trace(
    capability: Capability,
    session: Session,
    resourceId: string,
    facts: Record<string, string | number | boolean>,
    requestId: string = crypto.randomUUID(),
  ): string {
    logPermissiveTrace({
      requestId,
      capability,
      principalId: session.user.id,
      resourceId,
      facts,
    });
    return requestId;
  }

  function evaluatePlan(
    plan: QueryPlan,
    capability: "data.query" | "data.aggregate" | "data.export",
    session: Session,
    requestId: string,
  ) {
    const compiled = compileQuery(plan);
    const evaluation = database.evaluate(
      compiled,
      compileCardinalityQuery(plan),
    );
    trace(
      capability,
      session,
      "workforce",
      {
        planKind: plan.kind,
        purpose: plan.purpose,
        matchingCount: evaluation.matchingCount,
        minimumGroupSize: evaluation.minimumGroupSize,
      },
      requestId,
    );
    return { compiled, evaluation };
  }

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
    noStore(context);
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
    noStore(context);
    const session = await requireSession(context);
    if (!session) {
      return context.json({ error: "authentication_required" }, 401);
    }
    const requestId = trace("dataset.inspect", session, "workforce", {
      fieldCount: datasetFields.length,
    });
    return context.json({
      requestId,
      dataset: {
        id: "workforce",
        recordCount: 18,
        fields: datasetFields,
      },
    });
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
    const requestId = crypto.randomUUID();
    try {
      const { compiled, evaluation } = evaluatePlan(
        parsed.data,
        expectedKind === "rows" ? "data.query" : "data.aggregate",
        session,
        requestId,
      );
      return context.json({
        requestId,
        columns: compiled.outputColumns,
        rows: evaluation.rows,
      });
    } catch {
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
    const requestId = crypto.randomUUID();
    try {
      const { compiled, evaluation } = evaluatePlan(
        parsed.data,
        "data.export",
        session,
        requestId,
      );
      const created = exports.create(
        session.user.id,
        parsed.data,
        compiled.outputColumns,
        evaluation,
      );
      return context.json({ requestId, ...created }, 201);
    } catch {
      return context.json({ error: "export_unavailable", requestId }, 503);
    }
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
    const current = database.getExportById(exportId.data);
    if (!current) {
      return context.json({ error: "export_not_found" }, 404);
    }
    trace("export.revoke", session, current.id, {
      ownerMatch: current.ownerId === session.user.id,
      state: current.state,
    });
    const value = database.revokeExport(current.id);
    if (!value) throw new Error("Export disappeared during revocation");
    return context.json({ export: value });
  });

  app.post("/api/exports/download", async (context) => {
    noStore(context);
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
    const current = database.getExportByReference(parsed.data.downloadRef);
    if (!current) {
      return context.json({ error: "export_not_found" }, 404);
    }
    if (current.state === "expired" || current.state === "revoked") {
      return context.json({ error: `export_${current.state}` }, 410);
    }
    if (!current.filePath)
      return context.json({ error: "export_expired" }, 410);
    trace("export.download", session, current.id, {
      ownerMatch: current.ownerId === session.user.id,
      purpose: current.purpose,
      rowCount: current.rowCount,
    });
    const bytes = exports.read(current.filePath);
    context.header("content-type", "text/csv; charset=utf-8");
    context.header(
      "content-disposition",
      `attachment; filename="dataguard-${current.id}.csv"`,
    );
    return context.body(Uint8Array.from(bytes).buffer);
  });

  app.onError((error, context) => {
    console.error(
      JSON.stringify({ event: "P5 request failed", error: error.name }),
    );
    return context.json({ error: "internal_error" }, 500);
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
