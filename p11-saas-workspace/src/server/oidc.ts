import * as oidc from "openid-client";
import type { AppConfig } from "./config.ts";
import type { OidcTokens, OidcTransaction } from "./models.ts";

type OidcIdentity = Readonly<{
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
        scope: "openid profile workspace.access",
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
      const expiresIn = response.expiresIn();
      if (
        !claims?.sub ||
        claims.iss !== config.issuer ||
        !claims.exp ||
        !response.access_token ||
        !response.id_token ||
        !response.token_type ||
        expiresIn === undefined ||
        !response.scope?.split(/\s+/).includes("workspace.access")
      ) {
        throw new Error("OIDC response did not contain the bounded P11 grant");
      }
      const tokens: OidcTokens = {
        issuer: claims.iss,
        subject: claims.sub,
        accessToken: response.access_token,
        accessTokenExpiresAt: Date.now() + expiresIn * 1_000,
        ...(response.refresh_token
          ? { refreshToken: response.refresh_token }
          : {}),
        idToken: response.id_token,
        idTokenExpiresAt: claims.exp * 1_000,
        tokenType: response.token_type,
        scope: response.scope,
      };
      return { issuer: claims.iss, subject: claims.sub, tokens };
    },
  };
}
