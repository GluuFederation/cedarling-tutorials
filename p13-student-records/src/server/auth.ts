import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as cookie from "cookie";
import type express from "express";
import type { Request } from "express";
import { isAccountId, type SessionView } from "../shared/contracts.ts";
import type { AppConfig } from "./config.ts";
import type { SchoolDatabase } from "./database.ts";
import { AppError, invalid, unauthorized } from "./errors.ts";
import type { LoginTransaction, OidcRuntime } from "./oidc.ts";

const randomToken = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type StoredSession = { subject: string; csrfToken: string; expiresAt: number };
function rawCookie(request: Request, name: string): string | undefined {
  try {
    return cookie.parseCookie(request.headers.cookie ?? "")[name];
  } catch {
    return undefined;
  }
}
export function registerAuth(
  app: express.Express,
  database: SchoolDatabase,
  config: AppConfig,
  oidc: OidcRuntime,
) {
  database.sql.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      subject TEXT NOT NULL REFERENCES actors(id),
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_transactions (
      id_hash TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      nonce TEXT NOT NULL,
      verifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const sessionName = "p13_session";
  const transactionName = "p13_login";
  const makeCookie = (name: string, value: string, maxAge: number) =>
    cookie.stringifySetCookie({
      name,
      value,
      maxAge,
      path: name === transactionName ? "/auth/callback" : "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.baseUrl.startsWith("https:"),
    });
  const removeSession = (request: Request) => {
    const value = rawCookie(request, sessionName);
    if (value)
      database.sql
        .prepare("DELETE FROM sessions WHERE id_hash=?")
        .run(hash(value));
  };
  function requireSession(request: Request): SessionView {
    const value = rawCookie(request, sessionName);
    const session = value
      ? database.sql
          .prepare<[string, number], StoredSession>(
            "SELECT subject,csrf_token csrfToken,expires_at expiresAt FROM sessions WHERE id_hash=? AND expires_at>?",
          )
          .get(hash(value), Date.now())
      : undefined;
    const actor = session ? database.principal(session.subject) : undefined;
    if (
      !session ||
      !actor ||
      actor.issuer !== config.issuer ||
      !isAccountId(actor.id)
    ) {
      removeSession(request);
      throw unauthorized();
    }
    return {
      user: { id: actor.id, name: actor.name, role: actor.role },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  }
  function requireMutation(request: Request, session: SessionView): void {
    const csrf = request.headers["x-csrf-token"];
    const site = request.headers["sec-fetch-site"];
    if (
      request.headers.origin !== config.baseUrl ||
      (site !== undefined && site !== "same-origin" && site !== "none") ||
      typeof csrf !== "string" ||
      Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrfToken) ||
      !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrfToken))
    )
      throw new AppError(
        403,
        "FORBIDDEN",
        "Request verification failed. Reload and try again.",
      );
  }
  app.get("/auth/login", async (request, response) => {
    const hint = request.query.login_hint;
    if (!isAccountId(hint)) throw invalid();
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new AppError(403, "FORBIDDEN", "Start sign-in from CedarSchool.");
    database.sql
      .prepare("DELETE FROM login_transactions WHERE expires_at<=?")
      .run(Date.now());
    database.sql
      .prepare("DELETE FROM sessions WHERE expires_at<=?")
      .run(Date.now());
    const count =
      database.sql
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) count FROM login_transactions",
        )
        .get()?.count ?? 0;
    if (count >= 100)
      throw new AppError(
        429,
        "TRY_LATER",
        "Too many sign-in attempts. Try later.",
      );
    const value = randomToken();
    const transaction: LoginTransaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
    };
    const url = await oidc.authorizationUrl(transaction, hint);
    database.sql
      .prepare("INSERT INTO login_transactions VALUES (?,?,?,?,?)")
      .run(
        hash(value),
        transaction.state,
        transaction.nonce,
        transaction.verifier,
        Date.now() + 5 * 60 * 1000,
      );
    removeSession(request);
    response.setHeader("Set-Cookie", [
      makeCookie(sessionName, "", 0),
      makeCookie(transactionName, value, 300),
    ]);
    response.redirect(url.toString());
  });
  app.get("/auth/callback", async (request, response) => {
    const value = rawCookie(request, transactionName);
    response.appendHeader("Set-Cookie", makeCookie(transactionName, "", 0));
    const transaction = value
      ? database.sql
          .prepare<[string], LoginTransaction & { expiresAt: number }>(
            "DELETE FROM login_transactions WHERE id_hash=? RETURNING state,nonce,verifier,expires_at expiresAt",
          )
          .get(hash(value))
      : undefined;
    if (!transaction || transaction.expiresAt <= Date.now())
      throw new AppError(
        400,
        "LOGIN_REJECTED",
        "Sign-in expired. Start again.",
      );
    try {
      const identity = await oidc.exchange(
        new URL(request.originalUrl, config.baseUrl),
        transaction,
      );
      const actor = database.principal(identity.subject);
      if (
        !actor ||
        actor.issuer !== identity.issuer ||
        identity.issuer !== config.issuer ||
        !isAccountId(actor.id) ||
        !Number.isFinite(identity.expiresAt) ||
        identity.expiresAt <= Date.now()
      )
        throw new Error("Unmapped or expired identity");
      const count =
        database.sql
          .prepare<[number], { count: number }>(
            "SELECT COUNT(*) count FROM sessions WHERE expires_at>?",
          )
          .get(Date.now())?.count ?? 0;
      if (count >= 1000) throw new Error("Session capacity reached");
      removeSession(request);
      const sessionId = randomToken();
      const expiresAt = Math.min(
        identity.expiresAt,
        Date.now() + 30 * 60 * 1000,
      );
      database.sql
        .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
        .run(hash(sessionId), actor.id, randomToken(), expiresAt);
      response.appendHeader(
        "Set-Cookie",
        makeCookie(
          sessionName,
          sessionId,
          Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
        ),
      );
      response.redirect("/");
    } catch {
      throw new AppError(
        400,
        "LOGIN_REJECTED",
        "Sign-in could not be completed. Start again.",
      );
    }
  });
  app.get("/api/session", (request, response) =>
    response.json(requireSession(request)),
  );
  app.post("/auth/logout", (request, response) => {
    requireMutation(request, requireSession(request));
    removeSession(request);
    response.setHeader("Set-Cookie", makeCookie(sessionName, "", 0));
    response.status(204).end();
  });
  return { requireSession, requireMutation };
}
