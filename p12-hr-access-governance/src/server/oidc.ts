import * as oidc from "openid-client";
import type { Config } from "./config.ts";
import type { LoginTransaction } from "./database.ts";

type Identity = Readonly<{ subject: string; expiresAt: number }>;
export interface OidcRuntime {
  authorizationUrl(transaction: LoginTransaction, hint: string): Promise<URL>;
  exchange(url: URL, transaction: LoginTransaction): Promise<Identity>;
}
export async function createOidc(config: Config): Promise<OidcRuntime> {
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
        scope: "openid profile hr.access",
        resource: config.resource,
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
        { resource: config.resource },
      );
      const claims = tokens.claims();
      const expires = tokens.expiresIn();
      if (
        !claims?.sub ||
        claims.iss !== config.issuer ||
        !claims.exp ||
        expires === undefined ||
        expires <= 0 ||
        !tokens.access_token ||
        !tokens.id_token ||
        tokens.token_type?.toLowerCase() !== "bearer" ||
        !tokens.scope?.split(/\s+/).includes("hr.access")
      )
        throw new Error("Invalid bounded OIDC response");
      return {
        subject: claims.sub,
        expiresAt: Math.min(
          Date.now() + expires * 1000,
          claims.exp * 1000,
          Date.now() + 1800000,
        ),
      };
    },
  };
}
