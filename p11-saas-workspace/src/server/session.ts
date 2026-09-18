import { createCookie, redirect } from "react-router";
import type { AppConfig } from "./config.ts";
import { decryptJson, encryptJson, randomToken, tokenHash } from "./crypto.ts";
import type { AppDatabase } from "./database.ts";
import { forbidden, unauthorized } from "./errors.ts";
import { limits } from "./limits.ts";
import type { OidcRuntime } from "./oidc.ts";
import type { OidcTokens, Session } from "./models.ts";
import { safeEqual } from "./validation.ts";

const allowedLoginHints = new Set(["maya", "noah", "lena", "imani"]);

export class SessionManager {
  readonly #config: AppConfig;
  readonly #database: AppDatabase;
  readonly #oidc: OidcRuntime;
  readonly #sessionCookie;
  readonly #transactionCookie;
  readonly #requests = new WeakMap<Request, Promise<Session | undefined>>();

  constructor(config: AppConfig, database: AppDatabase, oidc: OidcRuntime) {
    this.#config = config;
    this.#database = database;
    this.#oidc = oidc;
    const common = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: config.baseUrl.startsWith("https:"),
      secrets: [config.sessionSecret],
    };
    this.#sessionCookie = createCookie("p11_session", {
      ...common,
      path: "/",
      maxAge: limits.sessionMs / 1_000,
    });
    this.#transactionCookie = createCookie("p11_oidc_transaction", {
      ...common,
      path: "/auth/callback",
      maxAge: limits.oidcTransactionMs / 1_000,
    });
  }

  optional(request: Request): Promise<Session | undefined> {
    const existing = this.#requests.get(request);
    if (existing) return existing;
    const pending = this.#resolve(request);
    this.#requests.set(request, pending);
    return pending;
  }

  async require(request: Request): Promise<Session> {
    const session = await this.optional(request);
    if (!session) throw unauthorized();
    return session;
  }

  requireMutation(request: Request, session: Session, form: FormData): void {
    const origin = request.headers.get("Origin");
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    const csrf = form.get("_csrf");
    if (
      origin !== new URL(this.#config.baseUrl).origin ||
      (fetchSite !== null &&
        fetchSite !== "same-origin" &&
        fetchSite !== "none") ||
      typeof csrf !== "string" ||
      !safeEqual(csrf, session.csrfToken)
    ) {
      throw forbidden();
    }
  }

  async login(request: Request): Promise<Response> {
    const hint = new URL(request.url).searchParams.get("login_hint");
    if (!hint || !allowedLoginHints.has(hint)) {
      return Response.json(
        { error: "invalid_tutorial_login_hint" },
        { status: 400 },
      );
    }
    const rawId = randomToken();
    const transaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
    };
    await this.#database.createTransaction(
      tokenHash(rawId),
      transaction,
      new Date(Date.now() + limits.oidcTransactionMs),
    );
    return redirect(
      (await this.#oidc.authorizationUrl(transaction, hint)).toString(),
      {
        headers: {
          "Set-Cookie": await this.#transactionCookie.serialize(rawId),
        },
      },
    );
  }

  async callback(request: Request): Promise<Response> {
    const rawTransaction = await this.#cookieValue(
      this.#transactionCookie,
      request,
    );
    const transaction = rawTransaction
      ? await this.#database.consumeTransaction(tokenHash(rawTransaction))
      : undefined;
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Set-Cookie": await this.#transactionCookie.serialize("", { maxAge: 0 }),
    });
    if (!transaction) {
      return Response.json(
        { error: "invalid_or_expired_login_transaction" },
        { status: 400, headers },
      );
    }
    try {
      const identity = await this.#oidc.exchange(
        new URL(request.url),
        transaction,
      );
      const principal = await this.#database.findPrincipal(
        identity.issuer,
        identity.subject,
      );
      if (!principal) {
        return Response.json(
          { error: "unmapped_tutorial_identity" },
          { status: 403, headers },
        );
      }
      const rawSession = randomToken();
      await this.#database.createSession({
        idHash: tokenHash(rawSession),
        principalId: principal.id,
        csrfToken: randomToken(),
        encryptedTokens: encryptJson(
          identity.tokens,
          this.#config.sessionSecret,
        ),
        expiresAt: new Date(
          Math.min(
            Date.now() + limits.sessionMs,
            identity.tokens.accessTokenExpiresAt,
            identity.tokens.idTokenExpiresAt,
          ),
        ),
      });
      headers.append(
        "Set-Cookie",
        await this.#sessionCookie.serialize(rawSession),
      );
      return redirect("/", { headers });
    } catch {
      return Response.json(
        { error: "login_callback_rejected" },
        { status: 400, headers },
      );
    }
  }

  async logout(request: Request, form: FormData): Promise<Response> {
    const rawId = await this.#cookieValue(this.#sessionCookie, request);
    const session = await this.optional(request);
    if (session) this.requireMutation(request, session, form);
    if (rawId) await this.#database.deleteSession(tokenHash(rawId));
    return redirect("/", {
      headers: {
        "Set-Cookie": await this.#sessionCookie.serialize("", { maxAge: 0 }),
      },
    });
  }

  async #resolve(request: Request): Promise<Session | undefined> {
    const rawId = await this.#cookieValue(this.#sessionCookie, request);
    if (!rawId) return undefined;
    const session = await this.#database.session(tokenHash(rawId));
    if (!session) return undefined;
    let tokens: OidcTokens;
    try {
      tokens = decryptJson<OidcTokens>(
        session.encryptedTokens,
        this.#config.sessionSecret,
      );
    } catch {
      await this.#database.deleteSession(tokenHash(rawId));
      return undefined;
    }
    if (
      tokens.issuer !== session.principal.issuer ||
      tokens.subject !== session.principal.subject ||
      tokens.accessTokenExpiresAt <= Date.now() ||
      tokens.idTokenExpiresAt <= Date.now()
    ) {
      await this.#database.deleteSession(tokenHash(rawId));
      return undefined;
    }
    return session;
  }

  async #cookieValue(
    cookie: { parse(value: string | null): Promise<unknown> },
    request: Request,
  ): Promise<string | undefined> {
    const value = await cookie.parse(request.headers.get("Cookie"));
    return typeof value === "string" && value ? value : undefined;
  }
}
