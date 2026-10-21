import * as oidc from "openid-client";
import type { Config } from "../config/environment.ts";
import type { LoginTransaction } from "./auth-store.ts";

export interface OidcRuntime {
  authorizationUrl(transaction: LoginTransaction, hint: string): Promise<URL>;
  exchange(
    url: URL,
    transaction: Omit<LoginTransaction, "id">,
  ): Promise<{ subject: string; accessToken: string; expiresAt: number }>;
}

export async function createOidc(config: Config): Promise<OidcRuntime> {
  const issuer = new URL(config.issuer);
  const client = await oidc.discovery(
    issuer,
    config.clientId,
    { id_token_signed_response_alg: "RS256" },
    oidc.ClientSecretBasic(config.clientSecret),
    {
      execute:
        issuer.protocol === "http:"
          ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks]
          : [oidc.enableNonRepudiationChecks],
      timeout: 10,
    },
  );
  return {
    async authorizationUrl(transaction, hint) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: "openid profile game.access",
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
      const seconds = tokens.expiresIn();
      if (
        !claims?.sub ||
        claims.iss !== config.issuer ||
        typeof claims.exp !== "number" ||
        !tokens.access_token ||
        !tokens.id_token ||
        !Number.isFinite(seconds) ||
        seconds === undefined ||
        seconds <= 0 ||
        tokens.token_type?.toLowerCase() !== "bearer" ||
        !tokens.scope?.split(/\s+/u).includes("game.access")
      )
        throw new Error("OIDC did not return a valid bounded P14 grant");
      return {
        subject: claims.sub,
        accessToken: tokens.access_token,
        expiresAt: Math.min(
          claims.exp * 1000,
          Date.now() + seconds * 1000,
          Date.now() + 30 * 60_000,
        ),
      };
    },
  };
}
