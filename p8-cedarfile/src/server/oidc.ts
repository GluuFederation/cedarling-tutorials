import * as oidc from "openid-client";
import type { AppConfig } from "./config.ts";

export const p8Scopes = ["file.access"] as const;

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
  refreshTokenExpiresAt: number;
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

function storeTokens(
  response: TokenResponse,
  issuer: string,
  subject: string,
  previous?: OidcTokens,
): OidcTokens {
  const now = Date.now();
  const claims = response.claims();
  if (claims && (claims.iss !== issuer || claims.sub !== subject)) {
    throw new Error("The refreshed identity token changed principal");
  }
  const expiresIn = response.expiresIn();
  if (expiresIn === undefined)
    throw new Error("The access token has no expiry");
  const idToken = response.id_token ?? previous?.idToken;
  const refreshToken = response.refresh_token ?? previous?.refreshToken;
  const idTokenExpiresAt = claims?.exp
    ? claims.exp * 1_000
    : previous?.idTokenExpiresAt;
  const refreshTokenExpiresAt = response.refresh_token
    ? now + 30 * 60 * 1000
    : previous?.refreshTokenExpiresAt;
  const scope = response.scope ?? previous?.scope;
  if (
    !idToken ||
    !refreshToken ||
    !idTokenExpiresAt ||
    !refreshTokenExpiresAt ||
    !scope?.split(/\s+/).includes("file.access")
  ) {
    throw new Error("The token response did not contain the required P8 grant");
  }
  return {
    issuer,
    subject,
    accessToken: requiredString(response.access_token, "an access token"),
    accessTokenExpiresAt: now + expiresIn * 1_000,
    refreshToken,
    refreshTokenExpiresAt,
    idToken,
    idTokenExpiresAt,
    tokenType: requiredString(response.token_type, "a token type"),
    scope,
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
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: [
          "openid",
          "profile",
          "email",
          "offline_access",
          ...p8Scopes,
        ].join(" "),
        resource: config.apiResource,
        code_challenge: await oidc.calculatePKCECodeChallenge(
          transaction.verifier,
        ),
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
        throw new Error("The identity token has an unexpected principal");
      }
      return {
        issuer: claims.iss,
        subject: claims.sub,
        tokens: storeTokens(response, claims.iss, claims.sub),
      };
    },
    async refresh(tokens) {
      if (tokens.refreshTokenExpiresAt <= Date.now()) {
        throw new Error("The refresh token has expired");
      }
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
