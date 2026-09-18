import * as oidc from "openid-client";
import { capabilities } from "../shared/capabilities.ts";
import type { Config } from "./config.ts";
import type { LoginTransaction } from "./database.ts";

type Identity = Readonly<{ subject: string; expiresAt: number }>;

export interface OidcRuntime {
  authorizationUrl(transaction: LoginTransaction, hint: string): Promise<URL>;
  exchange(
    url: URL,
    transaction: Omit<LoginTransaction, "id">,
  ): Promise<Identity>;
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
  const scopes = ["openid", "profile", ...Object.values(capabilities)].join(
    " ",
  );
  return {
    async authorizationUrl(transaction, hint) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: scopes,
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
        Object.values(capabilities).some((scope) => !granted.has(scope))
      ) {
        throw new Error("Invalid bounded OIDC response");
      }
      return {
        subject: claims.sub,
        expiresAt: Math.min(
          claims.exp * 1000,
          Date.now() + expiresIn * 1000,
          Date.now() + 30 * 60_000,
        ),
      };
    },
  };
}
