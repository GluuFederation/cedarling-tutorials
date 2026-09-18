import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { authenticationRequired } from "../errors.js";
import type { PersonaId } from "../rag/types.js";

export type AuthenticatedPrincipal = Readonly<{
  id: PersonaId;
  accessToken: string;
}>;

type AuthenticationDiagnostic = Readonly<{
  event: "authentication_rejected";
  reason: string;
}>;

export type Authenticator = Readonly<{
  authenticate: (
    authorizationHeader: string | undefined,
  ) => Promise<AuthenticatedPrincipal>;
}>;

type AuthenticatorOptions = Readonly<{
  issuer: string;
  audience: string;
  keySet?: JWTVerifyGetKey;
  diagnostics?: (diagnostic: AuthenticationDiagnostic) => void;
}>;

const personas = new Set<PersonaId>(["ada", "leo", "mallory"]);

function bearerToken(header: string | undefined): string {
  const match = header?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) throw authenticationRequired();
  return match[1];
}

function diagnosticReason(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^ERR_[A-Z0-9_]{1,60}$/.test(error.code)
  ) {
    return error.code;
  }
  return "invalid_token";
}

function defaultDiagnostics(diagnostic: AuthenticationDiagnostic): void {
  console.warn("P2 authentication rejected", diagnostic);
}

/** Verifies the JWT before mapping it to one of P2's synthetic principals. */
export function createAuthenticator(
  options: AuthenticatorOptions,
): Authenticator {
  const keySet =
    options.keySet ?? createRemoteJWKSet(new URL(`${options.issuer}/jwks`));
  const diagnostics = options.diagnostics ?? defaultDiagnostics;
  return {
    async authenticate(authorizationHeader) {
      let token: string;
      try {
        token = bearerToken(authorizationHeader);
      } catch {
        diagnostics({
          event: "authentication_rejected",
          reason: "missing_or_malformed_bearer",
        });
        throw authenticationRequired();
      }

      let verified;
      try {
        verified = await jwtVerify(token, keySet, {
          algorithms: ["RS256"],
          audience: options.audience,
          issuer: options.issuer,
        });
      } catch (error) {
        diagnostics({
          event: "authentication_rejected",
          reason: diagnosticReason(error),
        });
        throw authenticationRequired();
      }

      const subject = verified.payload.sub;
      if (typeof subject !== "string" || !personas.has(subject as PersonaId)) {
        diagnostics({
          event: "authentication_rejected",
          reason: "unknown_subject",
        });
        throw authenticationRequired();
      }
      return { id: subject as PersonaId, accessToken: token };
    },
  };
}
