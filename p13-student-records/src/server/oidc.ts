import * as oidc from "openid-client";
import type { AppConfig } from "./config.ts";

export type LoginTransaction = {
  state: string;
  nonce: string;
  verifier: string;
};
type LoginIdentity = {
  issuer: string;
  subject: string;
  expiresAt: number;
};
export interface OidcRuntime {
  authorizationUrl(
    transaction: LoginTransaction,
    loginHint: string,
  ): Promise<URL>;
  exchange(
    callback: URL,
    transaction: LoginTransaction,
  ): Promise<LoginIdentity>;
}

export async function createOidc(config: AppConfig): Promise<OidcRuntime> {
  const client = await oidc.discovery(
    new URL(config.issuer),
    config.clientId,
    { id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(config.clientSecret),
    {
      execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks],
      timeout: 10,
    },
  );
  return {
    async authorizationUrl(transaction, loginHint) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: "openid profile grade.access",
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
    async exchange(callback, transaction) {
      const response = await oidc.authorizationCodeGrant(
        client,
        callback,
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
        typeof claims.exp !== "number" ||
        !response.access_token ||
        !response.id_token ||
        response.token_type.toLowerCase() !== "bearer" ||
        expiresIn === undefined ||
        expiresIn <= 0 ||
        !response.scope?.split(/\s+/u).includes("grade.access")
      )
        throw new Error(
          "OIDC response did not contain a valid bounded P13 grant",
        );
      return {
        issuer: claims.iss,
        subject: claims.sub,
        expiresAt: Math.min(
          Date.now() + expiresIn * 1000,
          claims.exp * 1000,
          Date.now() + 30 * 60 * 1000,
        ),
      };
    },
  };
}
