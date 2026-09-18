import * as oidc from "openid-client";
import { capabilities } from "./authorization.ts";
import type { AppConfig } from "./config.ts";
import type { OidcTokens, OidcTransaction } from "./models.ts";

export type OidcIdentity = {
  issuer: string;
  subject: string;
  tokens: OidcTokens;
};

export interface OidcRuntime {
  authorizationUrl(transaction: OidcTransaction, hint: string): Promise<URL>;
  exchange(url: URL, transaction: OidcTransaction): Promise<OidcIdentity>;
}

export async function createOidcRuntime(
  config: AppConfig,
): Promise<OidcRuntime> {
  const issuer = new URL(config.issuer);
  const client = await oidc.discovery(
    issuer,
    config.clientId,
    config.clientSecret,
    oidc.ClientSecretBasic(config.clientSecret),
    issuer.protocol === "http:"
      ? { execute: [oidc.allowInsecureRequests] }
      : undefined,
  );
  oidc.enableNonRepudiationChecks(client);
  return {
    async authorizationUrl(transaction, hint) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: `openid profile ${capabilities.join(" ")}`,
        resource: config.apiResource,
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(
          transaction.verifier,
        ),
        code_challenge_method: "S256",
        login_hint: hint,
        prompt: "login consent",
      });
    },
    async exchange(url, transaction) {
      const tokens = await oidc.authorizationCodeGrant(
        client,
        url,
        {
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          pkceCodeVerifier: transaction.verifier,
        },
        { resource: config.apiResource },
      );
      const claims = tokens.claims();
      const expiresIn = tokens.expiresIn();
      const granted = new Set(tokens.scope?.split(/\s+/u));
      if (
        !claims?.sub ||
        claims.iss !== config.issuer ||
        !claims.exp ||
        !tokens.access_token ||
        !tokens.id_token ||
        expiresIn === undefined ||
        expiresIn <= 0 ||
        tokens.token_type?.toLowerCase() !== "bearer" ||
        capabilities.some((scope) => !granted.has(scope))
      ) {
        throw new Error("Invalid bounded OIDC response");
      }
      const maximum = Date.now() + 30 * 60_000;
      const identityTokens: OidcTokens = {
        issuer: claims.iss,
        subject: claims.sub,
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        accessTokenExpiresAt: Math.min(Date.now() + expiresIn * 1000, maximum),
        idTokenExpiresAt: Math.min(claims.exp * 1000, maximum),
      };
      return {
        issuer: claims.iss,
        subject: claims.sub,
        tokens: identityTokens,
      };
    },
  };
}
