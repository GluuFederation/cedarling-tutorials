import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { parseCookie, stringifySetCookie } from "cookie";
import type { Express, Request } from "express";
import { accounts } from "../shared/contracts.ts";
import type { Config } from "./config.ts";
import type { Database, LoginTransaction, Session } from "./database.ts";
import { AppError, denied, unauthorized } from "./errors.ts";
import type { OidcRuntime } from "./oidc.ts";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
function cookie(request: Request, name: string): string | undefined {
  return parseCookie(request.headers.cookie ?? "")[name];
}
function setCookie(name: string, value: string, maxAge: number, path = "/") {
  return stringifySetCookie({
    name,
    value,
    maxAge,
    path,
    httpOnly: true,
    sameSite: "lax",
  });
}
function authBoundary(db: Database, config: Config) {
  return {
    session(request: Request): Session {
      const id = cookie(request, "p12_session");
      const session = id ? db.session(hash(id)) : undefined;
      if (!session || !db.principal(session.principalId)) throw unauthorized();
      return session;
    },
    mutation(request: Request, session: Session) {
      const csrf = request.headers["x-csrf-token"];
      const site = request.headers["sec-fetch-site"];
      if (
        request.headers.origin !== config.baseUrl ||
        (site !== undefined && site !== "same-origin" && site !== "none") ||
        typeof csrf !== "string" ||
        Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrfToken) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrfToken))
      )
        throw denied();
    },
  };
}
export function registerAuth(
  app: Express,
  db: Database,
  config: Config,
  oidc: OidcRuntime,
) {
  const auth = authBoundary(db, config);
  app.get("/auth/login", async (request, response) => {
    const hint = request.query.login_hint;
    if (
      typeof hint !== "string" ||
      !accounts.some((account) => account.id === hint)
    )
      throw new AppError(
        400,
        "INVALID_IDENTITY",
        "Choose an available identity.",
      );
    db.prune();
    const count = db.sql
      .prepare<[], { count: number }>(
        "SELECT count(*) count FROM login_transactions",
      )
      .get();
    if ((count?.count ?? 0) >= 128)
      throw new AppError(
        503,
        "LOGIN_BUSY",
        "Too many sign-in attempts. Try again later.",
      );
    const oldSession = cookie(request, "p12_session");
    if (oldSession)
      db.sql.prepare("DELETE FROM sessions WHERE id = ?").run(hash(oldSession));
    const oldTransaction = cookie(request, "p12_login");
    if (oldTransaction)
      db.sql
        .prepare("DELETE FROM login_transactions WHERE id = ?")
        .run(hash(oldTransaction));
    const rawId = token();
    const transaction = { state: token(), nonce: token(), verifier: token() };
    const target = await oidc.authorizationUrl(transaction, hint);
    db.sql
      .prepare("INSERT INTO login_transactions VALUES (?,?,?)")
      .run(hash(rawId), JSON.stringify(transaction), Date.now() + 300000);
    response.setHeader("Set-Cookie", [
      setCookie("p12_login", rawId, 300, "/auth"),
      setCookie("p12_session", "", 0),
    ]);
    response.redirect(target.href);
  });
  app.get("/auth/callback", async (request, response) => {
    response.setHeader("Set-Cookie", setCookie("p12_login", "", 0, "/auth"));
    const rawId = cookie(request, "p12_login");
    db.prune();
    const stored = rawId
      ? db.sql
          .prepare<[string], { value: string }>(
            "DELETE FROM login_transactions WHERE id = ? RETURNING value",
          )
          .get(hash(rawId))
      : undefined;
    if (!stored)
      throw new AppError(
        400,
        "LOGIN_REJECTED",
        "Sign-in expired. Choose an identity again.",
      );
    try {
      const identity = await oidc.exchange(
        new URL(request.originalUrl, config.baseUrl),
        JSON.parse(stored.value) as LoginTransaction,
      );
      const principal = db.principal(identity.subject);
      if (
        !principal ||
        !accounts.some((account) => account.id === principal.id) ||
        identity.expiresAt <= Date.now()
      )
        throw denied();
      db.prune();
      const count = db.sql
        .prepare<[], { count: number }>("SELECT count(*) count FROM sessions")
        .get();
      if ((count?.count ?? 0) >= 1000)
        throw new Error("Session capacity reached");
      const rawSession = token();
      db.sql
        .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
        .run(hash(rawSession), principal.id, token(), identity.expiresAt);
      response.appendHeader(
        "Set-Cookie",
        setCookie(
          "p12_session",
          rawSession,
          Math.max(1, Math.floor((identity.expiresAt - Date.now()) / 1000)),
        ),
      );
      response.redirect("/");
    } catch {
      throw new AppError(
        400,
        "LOGIN_REJECTED",
        "Sign-in could not be verified. Choose an identity again.",
      );
    }
  });
  app.post("/auth/logout", (request, response) => {
    const session = auth.session(request);
    auth.mutation(request, session);
    db.sql.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    response.setHeader("Set-Cookie", setCookie("p12_session", "", 0));
    response.status(204).end();
  });
  return auth;
}
