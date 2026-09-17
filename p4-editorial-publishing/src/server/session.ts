import { cookies, headers } from "next/headers";
import { personaForSubject } from "../shared/personas.ts";
import type { AppConfig } from "./config.ts";
import {
  decryptJson,
  encryptJson,
  randomToken,
  safeEqual,
  tokenHash,
} from "./crypto.ts";
import type { AppDatabase } from "./database.ts";
import { forbidden, unauthorized } from "./errors.ts";
import type { OidcTokens, OidcTransaction, Session } from "./models.ts";
import type { OidcRuntime } from "./oidc.ts";

export const sessionCookie = "p4_session";
export const transactionCookie = "p4_oidc_transaction";
export const sessionSeconds = 30 * 60;
const transactionSeconds = 2 * 60;

export class SessionManager {
  private readonly config: AppConfig;
  private readonly database: AppDatabase;
  private readonly oidc: OidcRuntime;

  constructor(config: AppConfig, database: AppDatabase, oidc: OidcRuntime) {
    this.config = config;
    this.database = database;
    this.oidc = oidc;
  }

  cookieOptions(maxAge = sessionSeconds) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.config.baseUrl.startsWith("https:"),
      path: "/",
      maxAge,
    };
  }

  async beginLogin(hint: string | null): Promise<{ raw: string; url: URL }> {
    if (!hint || !personaForSubject(hint)) throw forbidden();
    const raw = randomToken();
    const transaction: OidcTransaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(48),
      expiresAt: Date.now() + transactionSeconds * 1000,
    };
    this.database.createTransaction(tokenHash(raw), transaction);
    return { raw, url: await this.oidc.authorizationUrl(transaction, hint) };
  }

  async finishLogin(url: URL, rawTransaction: string): Promise<string> {
    const transaction = this.database.consumeTransaction(
      tokenHash(rawTransaction),
    );
    if (!transaction) throw forbidden();
    const identity = await this.oidc.exchange(url, transaction);
    const principal = this.database.principal(
      identity.issuer,
      identity.subject,
    );
    if (!principal) throw forbidden();
    const rawSession = randomToken();
    this.database.createSession({
      idHash: tokenHash(rawSession),
      principalId: principal.id,
      csrfToken: randomToken(),
      encryptedTokens: encryptJson(identity.tokens, this.config.sessionSecret),
      expiresAt: Math.min(
        Date.now() + sessionSeconds * 1000,
        identity.tokens.accessTokenExpiresAt,
        identity.tokens.idTokenExpiresAt,
      ),
    });
    return rawSession;
  }

  resolve(raw: string | undefined): Session | undefined {
    if (!raw) return undefined;
    const session = this.database.session(tokenHash(raw));
    if (!session) return undefined;
    try {
      const tokens = decryptJson<OidcTokens>(
        session.encryptedTokens,
        this.config.sessionSecret,
      );
      if (
        tokens.issuer !== session.principal.issuer ||
        tokens.subject !== session.principal.subject ||
        tokens.accessTokenExpiresAt <= Date.now() ||
        tokens.idTokenExpiresAt <= Date.now()
      ) {
        this.database.deleteSession(session.idHash);
        return undefined;
      }
    } catch {
      this.database.deleteSession(session.idHash);
      return undefined;
    }
    return {
      csrfToken: session.csrfToken,
      principal: session.principal,
    };
  }

  async optional(): Promise<Session | undefined> {
    return this.resolve((await cookies()).get(sessionCookie)?.value);
  }

  async require(): Promise<Session> {
    const session = await this.optional();
    if (!session) throw unauthorized();
    return session;
  }

  async requireMutation(form: FormData): Promise<Session> {
    const session = await this.require();
    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    const fetchSite = requestHeaders.get("sec-fetch-site");
    const csrf = form.get("_csrf");
    if (
      origin !== new URL(this.config.baseUrl).origin ||
      (fetchSite !== null &&
        fetchSite !== "same-origin" &&
        fetchSite !== "none") ||
      typeof csrf !== "string" ||
      !safeEqual(csrf, session.csrfToken)
    ) {
      throw forbidden();
    }
    return session;
  }

  logout(raw: string | undefined): void {
    if (raw) this.database.deleteSession(tokenHash(raw));
  }
}
