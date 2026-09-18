import * as oidc from "openid-client";
import type { AppConfig } from "./config.ts";

export const p5Scopes = ["data.access"] as const;

export type OidcTransaction = Readonly<{
  state: string;
  nonce: string;
  verifier: string;
}>;

export type OidcTokens = Readonly<{
  issuer: string;
  subject: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  idToken: string;
  idTokenExpiresAt: number;
  tokenType: string;
  scope: string;
}>;

export type OidcIdentity = Readonly<{
  issuer: string;
  subject: string;
  tokens: OidcTokens;
}>;

export interface OidcRuntime {
  authorizationUrl(
    transaction: OidcTransaction,
    loginHint: string,
  ): Promise<URL>;
  exchange(
    callbackUrl: URL,
    transaction: OidcTransaction,
  ): Promise<OidcIdentity>;
  refresh(tokens: OidcTokens): Promise<OidcTokens>;
}

type TokenResponse = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`The token response did not contain ${name}`);
  }
  return value;
}

/** Retains an existing grant only when a refresh response omits `scope`. */
export function requireGrantedScope(
  returnedScope: unknown,
  previousScope?: string,
): string {
  const scope =
    typeof returnedScope === "string" && returnedScope.trim()
      ? returnedScope
      : previousScope;
  if (!scope?.split(/\s+/).includes("data.access")) {
    throw new Error("The token response did not grant data.access");
  }
  return scope;
}

function storeTokens(
  response: TokenResponse,
  issuer: string,
  subject: string,
  previous?: OidcTokens,
): OidcTokens {
  const claims = response.claims();
  if (claims && (claims.iss !== issuer || claims.sub !== subject)) {
    throw new Error("The refreshed identity token changed principal");
  }
  const expiresIn = response.expiresIn();
  if (expiresIn === undefined)
    throw new Error("The access token has no expiry");
  const idToken = response.id_token ?? previous?.idToken;
  const idTokenExpiresAt = claims?.exp
    ? claims.exp * 1_000
    : previous?.idTokenExpiresAt;
  const refreshToken = response.refresh_token ?? previous?.refreshToken;
  if (!idToken || !idTokenExpiresAt || !refreshToken) {
    throw new Error(
      "The token response did not contain the required token set",
    );
  }
  return {
    issuer,
    subject,
    accessToken: requiredString(response.access_token, "an access token"),
    accessTokenExpiresAt: Date.now() + expiresIn * 1_000,
    refreshToken,
    idToken,
    idTokenExpiresAt,
    tokenType: requiredString(response.token_type, "a token type"),
    scope: requireGrantedScope(response.scope, previous?.scope),
  };
}

export async function createOidcRuntime(
  config: AppConfig,
): Promise<OidcRuntime> {
  const issuer = new URL(config.issuer);
  const localHttp =
    issuer.protocol === "http:" &&
    (issuer.hostname === "localhost" ||
      issuer.hostname === "127.0.0.1" ||
      issuer.hostname.endsWith(".localhost"));
  if (issuer.protocol === "http:" && !localHttp) {
    throw new Error("Plain HTTP is allowed only for loopback tutorial issuers");
  }
  const client = await oidc.discovery(
    issuer,
    config.clientId,
    config.clientSecret,
    undefined,
    localHttp ? { execute: [oidc.allowInsecureRequests] } : undefined,
  );

  return {
    async authorizationUrl(transaction, loginHint) {
      const challenge = await oidc.calculatePKCECodeChallenge(
        transaction.verifier,
      );
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: [
          "openid",
          "profile",
          "email",
          "offline_access",
          ...p5Scopes,
        ].join(" "),
        resource: config.apiResource,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: transaction.state,
        nonce: transaction.nonce,
        login_hint: loginHint,
        prompt: "login consent",
      });
    },
    async exchange(callbackUrl, transaction) {
      const response = await oidc.authorizationCodeGrant(
        client,
        callbackUrl,
        {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
        },
        { resource: config.apiResource },
      );
      const claims = response.claims();
      if (!claims?.sub || claims.iss !== config.issuer) {
        throw new Error(
          "The identity token did not contain the expected principal",
        );
      }
      return {
        issuer: claims.iss,
        subject: claims.sub,
        tokens: storeTokens(response, claims.iss, claims.sub),
      };
    },
    async refresh(tokens) {
      const response = await oidc.refreshTokenGrant(
        client,
        tokens.refreshToken,
        {
          resource: config.apiResource,
        },
      );
      return storeTokens(response, tokens.issuer, tokens.subject, tokens);
    },
  };
}
