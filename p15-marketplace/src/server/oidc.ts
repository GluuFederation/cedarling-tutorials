import * as oidc from "openid-client";
import type { Config } from "./config.ts";
import type { LoginTransaction } from "./database.ts";

type Identity = {
  subject: string;
  expiresAt: number;
  tokens: string;
};
export type Oidc = {
  authorization(transaction: LoginTransaction, hint: string): Promise<URL>;
  exchange(url: URL, transaction: LoginTransaction): Promise<Identity>;
};

export async function createOidc(config: Config): Promise<Oidc> {
  const client = await oidc.discovery(
    new URL(config.issuer),
    config.clientId,
    config.clientSecret,
    oidc.ClientSecretBasic(config.clientSecret),
    { execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] },
  );
  return {
    async authorization(transaction, hint) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.baseUrl}/auth/callback`,
        response_type: "code",
        scope: "openid profile refund.access",
        resource: config.apiResource,
        code_challenge: await oidc.calculatePKCECodeChallenge(
          transaction.verifier,
        ),
        code_challenge_method: "S256",
        state: transaction.state,
        nonce: transaction.nonce,
        login_hint: hint,
        prompt: "login consent",
      });
    },
    async exchange(url, transaction) {
      const tokens = await oidc.authorizationCodeGrant(
        client,
        url,
        {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
        },
        { resource: config.apiResource },
      );
      const claims = tokens.claims();
      const seconds = tokens.expiresIn();
      if (
        !claims ||
        claims.iss !== config.issuer ||
        typeof claims.sub !== "string" ||
        !claims.exp ||
        seconds === undefined ||
        seconds <= 0 ||
        !tokens.access_token ||
        !tokens.id_token ||
        tokens.token_type.toLowerCase() !== "bearer" ||
        !tokens.scope?.split(" ").includes("refund.access")
      )
        throw new Error("Bounded signed tutorial identity is missing");
      return {
        subject: claims.sub,
        expiresAt: Math.min(
          Date.now() + 1_800_000,
          Date.now() + seconds * 1000,
          claims.exp * 1000,
        ),
        tokens: JSON.stringify(tokens),
      };
    },
  };
}
