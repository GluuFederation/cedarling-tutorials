import type { OAuthTokenVerifier } from "@modelcontextprotocol/express";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { PersonaId } from "../incidents/types.js";

const personas = new Set<PersonaId>(["dana", "amir", "eve"]);

type TokenVerifierOptions = Readonly<{
  issuer: string;
  audience: string;
  clientId: string;
  keySet?: JWTVerifyGetKey;
}>;

export type VerifiedP3AccessToken = Readonly<{
  subject: PersonaId;
  scopes: string[];
  expiresAt: number;
}>;
function invalidToken(): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
}

function scopes(value: unknown): string[] {
  if (typeof value === "string") return value.split(" ").filter(Boolean);
  if (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === "string")
  ) {
    return value;
  }
  return [];
}

/** Builds the shared JWT verifier used by the CLI and MCP resource server. */
export function createP3AccessTokenVerifier(
  options: TokenVerifierOptions,
): (token: string) => Promise<VerifiedP3AccessToken> {
  const keySet =
    options.keySet ?? createRemoteJWKSet(new URL(`${options.issuer}/jwks`));
  return async (token) => {
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: ["RS256"],
      audience: options.audience,
      issuer: options.issuer,
    });
    const subject = payload.sub;
    const tokenClientId = payload.client_id;
    const tokenScopes = scopes(payload.scope);
    if (
      typeof subject !== "string" ||
      !personas.has(subject as PersonaId) ||
      tokenClientId !== options.clientId ||
      typeof payload.exp !== "number" ||
      !tokenScopes.includes("mcp.access")
    ) {
      throw new Error("Invalid P3 access token");
    }
    return {
      subject: subject as PersonaId,
      scopes: tokenScopes,
      expiresAt: payload.exp,
    };
  };
}

/** Adapts the shared verifier to the MCP SDK authentication contract. */
export function createTokenVerifier(
  options: TokenVerifierOptions,
): OAuthTokenVerifier {
  const verify = createP3AccessTokenVerifier(options);
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      try {
        const verified = await verify(token);
        return {
          token,
          clientId: options.clientId,
          scopes: verified.scopes,
          expiresAt: verified.expiresAt,
          resource: new URL(options.audience),
          extra: { subject: verified.subject },
        };
      } catch {
        throw invalidToken();
      }
    },
  };
}
