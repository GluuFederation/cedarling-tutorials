import * as cookie from "cookie";
import type express from "express";
import type { Request, Response } from "express";
import type { AuthorizationGateway } from "./authorization.ts";
import type { AppConfig } from "./config.ts";
import { limits } from "./config.ts";
import { randomToken, safeEqual } from "./crypto.ts";
import type { ChatRepository } from "./database.ts";
import type { Session } from "./models.ts";
import type { OidcRuntime } from "./oidc.ts";
import type { SessionStore } from "./session-store.ts";

const sessionCookie = "p9_session";
const transactionCookie = "p9_oidc_transaction";
const loginHints = new Set(["mei", "kwame", "yuki"]);

function serializeCookie(
  name: string,
  value: string,
  config: AppConfig,
  options: Readonly<{ path: string; maxAge: number }>,
): string {
  return cookie.stringifySetCookie({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: config.baseUrl.startsWith("https:"),
    path: options.path,
    maxAge: options.maxAge,
  });
}

function clearCookie(name: string, path: string, config: AppConfig): string {
  return serializeCookie(name, "", config, { path, maxAge: 0 });
}

function cookies(
  header: string | undefined,
): Record<string, string | undefined> {
  try {
    return cookie.parseCookie(header ?? "");
  } catch {
    return {};
  }
}

function noStore(response: Response): void {
  response.setHeader("Cache-Control", "private, no-store");
}

export type AuthBoundary = Readonly<{
  requireSession(
    request: Request,
    response: Response,
  ): Promise<Session | undefined>;
  sessionFromCookieHeader(header: string | undefined): Session | undefined;
  requireMutation(
    request: Request,
    response: Response,
    session: Session,
  ): boolean;
}>;

export function registerAuthRoutes(
  app: express.Express,
  config: AppConfig,
  sessions: SessionStore,
  chat: ChatRepository,
  oidc: OidcRuntime,
  authorization: AuthorizationGateway,
): AuthBoundary {
  const pendingRefresh = new Map<string, Promise<Session | undefined>>();

  function sessionFromCookieHeader(
    header: string | undefined,
  ): Session | undefined {
    const rawId = cookies(header)[sessionCookie];
    return rawId ? sessions.getSession(rawId, config) : undefined;
  }

  async function refreshedSession(rawId: string): Promise<Session | undefined> {
    const current = sessions.getSession(rawId, config);
    if (!current || current.tokens.accessTokenExpiresAt > Date.now() + 30_000) {
      return current;
    }
    let pending = pendingRefresh.get(rawId);
    if (!pending) {
      pending = (async () => {
        const latest = sessions.getSession(rawId, config);
        if (
          !latest ||
          latest.tokens.accessTokenExpiresAt > Date.now() + 30_000
        ) {
          return latest;
        }
        const tokens = await oidc.refresh(latest.tokens);
        sessions.updateTokens(rawId, tokens, config);
        return { ...latest, tokens };
      })();
      pendingRefresh.set(rawId, pending);
    }
    try {
      return await pending;
    } finally {
      if (pendingRefresh.get(rawId) === pending) pendingRefresh.delete(rawId);
    }
  }

  async function requireSession(
    request: Request,
    response: Response,
  ): Promise<Session | undefined> {
    const rawId = cookies(request.headers.cookie)[sessionCookie];
    if (!rawId) {
      response.status(401).json({ error: "authentication_required" });
      return undefined;
    }
    try {
      const session = await refreshedSession(rawId);
      if (session) return session;
    } catch {
      sessions.revokeSession(rawId);
    }
    response.setHeader("Set-Cookie", clearCookie(sessionCookie, "/", config));
    response.status(401).json({ error: "authentication_required" });
    return undefined;
  }

  function requireMutation(
    request: Request,
    response: Response,
    session: Session,
  ): boolean {
    const fetchSite = request.headers["sec-fetch-site"];
    const sameSite =
      fetchSite === undefined ||
      fetchSite === "same-origin" ||
      fetchSite === "none";
    const csrf = request.headers["x-csrf-token"];
    if (
      typeof csrf !== "string" ||
      !safeEqual(csrf, session.csrfToken) ||
      request.headers.origin !== new URL(config.baseUrl).origin ||
      !sameSite
    ) {
      response.status(403).json({ error: "request_verification_failed" });
      return false;
    }
    return true;
  }

  app.get("/auth/login", async (request, response) => {
    const loginHint = request.query.login_hint;
    if (typeof loginHint !== "string" || !loginHints.has(loginHint)) {
      response.status(400).json({ error: "invalid_tutorial_login_hint" });
      return;
    }
    const rawId = randomToken();
    const transaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
    };
    sessions.createTransaction({
      rawId,
      ...transaction,
      expiresAt: Date.now() + 5 * 60 * 1_000,
    });
    response.setHeader(
      "Set-Cookie",
      serializeCookie(transactionCookie, rawId, config, {
        path: "/auth/callback",
        maxAge: 300,
      }),
    );
    response.redirect(
      (await oidc.authorizationUrl(transaction, loginHint)).toString(),
    );
  });

  app.get("/auth/callback", async (request, response) => {
    noStore(response);
    const requestCookies = cookies(request.headers.cookie);
    const rawId = requestCookies[transactionCookie];
    const transaction = rawId ? sessions.consumeTransaction(rawId) : undefined;
    response.setHeader(
      "Set-Cookie",
      clearCookie(transactionCookie, "/auth/callback", config),
    );
    if (!transaction) {
      response
        .status(400)
        .json({ error: "invalid_or_expired_login_transaction" });
      return;
    }
    try {
      const identity = await oidc.exchange(
        new URL(request.originalUrl, config.baseUrl),
        transaction,
      );
      const mapped = chat.findUser(identity.issuer, identity.subject);
      if (!mapped) {
        response.status(403).json({ error: "unmapped_tutorial_identity" });
        return;
      }
      const previous = requestCookies[sessionCookie];
      if (previous) sessions.revokeSession(previous);
      const session = sessions.createSession(
        mapped.id,
        identity.tokens,
        config,
      );
      response.appendHeader(
        "Set-Cookie",
        serializeCookie(sessionCookie, session.rawId, config, {
          path: "/",
          maxAge: limits.sessionMs / 1_000,
        }),
      );
      response.redirect("/");
    } catch {
      response.status(400).json({ error: "login_callback_rejected" });
    }
  });

  app.post("/auth/logout", async (request, response) => {
    const session = await requireSession(request, response);
    if (!session || !requireMutation(request, response, session)) return;
    const rawId = cookies(request.headers.cookie)[sessionCookie];
    if (rawId) sessions.revokeSession(rawId);
    response.setHeader("Set-Cookie", clearCookie(sessionCookie, "/", config));
    response.status(204).end();
  });

  app.get("/api/session", async (request, response) => {
    noStore(response);
    const session = await requireSession(request, response);
    if (!session) return;
    response.json({
      user: { id: session.user.id, name: session.user.name },
      rooms: chat
        .roomsForUser(session.user.id)
        .map(({ nextSequence: _next, ...room }) => room),
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
      authzMode: "permissive",
    });
  });

  app.post("/api/connection-ticket", async (request, response) => {
    noStore(response);
    const session = await requireSession(request, response);
    if (!session || !requireMutation(request, response, session)) return;
    response.status(201).json(sessions.createTicket(session.idHash));
  });

  if (process.env.NODE_ENV !== "production") {
    app.get("/_debug/decisions/:requestId", async (request, response) => {
      noStore(response);
      const session = await requireSession(request, response);
      if (!session) return;
      const diagnostic = authorization.diagnostic(
        session.user.id,
        request.params.requestId,
      );
      if (!diagnostic) {
        response.status(404).json({ error: "decision_not_found" });
        return;
      }
      response.json(diagnostic);
    });
  }

  return { requireSession, sessionFromCookieHeader, requireMutation };
}
