import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Actor } from "../../shared/contracts.ts";
import type { AuthStore, Session } from "../auth/auth-store.ts";
import type { Config } from "../config/environment.ts";
import { HttpError } from "./errors.ts";

export const sessionCookie = "p14_session";
export const transactionCookie = "p14_oidc";

export function requireSession(
  request: FastifyRequest,
  auth: AuthStore,
): Session {
  const raw = request.cookies[sessionCookie];
  const session = raw ? auth.getSession(raw) : undefined;
  if (!session)
    throw new HttpError("authentication_required", 401, "Sign in to continue.");
  return session;
}

export function sameOrigin(request: FastifyRequest, config: Config): boolean {
  return (
    request.headers.origin === config.baseUrl &&
    (!request.headers["sec-fetch-site"] ||
      request.headers["sec-fetch-site"] === "same-origin")
  );
}

export function requireMutation(
  request: FastifyRequest,
  auth: AuthStore,
  config: Config,
): Session {
  const session = requireSession(request, auth);
  const csrf = request.headers["x-csrf-token"];
  if (
    !sameOrigin(request, config) ||
    typeof csrf !== "string" ||
    Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrfToken) ||
    !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrfToken))
  )
    throw new HttpError(
      "request_integrity_required",
      403,
      "Refresh the page before trying again.",
    );
  return session;
}

export function actorFor(session: Session, auth: AuthStore): Actor {
  return {
    ...session.user,
    sessionValid: () => auth.getSessionByHash(session.idHash) !== undefined,
  };
}

export function cookieOptions(config: Config, maxAge?: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.baseUrl.startsWith("https:"),
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}
