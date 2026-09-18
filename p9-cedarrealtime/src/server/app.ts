import { existsSync } from "node:fs";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { type AuthBoundary, registerAuthRoutes } from "./auth-routes.ts";
import type { AuthorizationGateway } from "./authorization.ts";
import type { AppConfig } from "./config.ts";
import { randomToken } from "./crypto.ts";
import type { ChatRepository } from "./database.ts";
import { DomainError } from "./errors.ts";
import type { OidcRuntime } from "./oidc.ts";
import type { SessionStore } from "./session-store.ts";

export async function buildApp(
  options: Readonly<{
    config: AppConfig;
    sessions: SessionStore;
    chat: ChatRepository;
    oidc: OidcRuntime;
    authorization: AuthorizationGateway;
    webRoot?: string;
  }>,
): Promise<{ app: express.Express; auth: AuthBoundary }> {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((_request, response, next) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    next();
  });
  app.use((_request, response, next) => {
    const requestId = `req_${randomToken(12)}`;
    response.locals.requestId = requestId;
    response.setHeader("X-Request-ID", requestId);
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  const auth = registerAuthRoutes(
    app,
    options.config,
    options.sessions,
    options.chat,
    options.oidc,
    options.authorization,
  );

  const webRoot = options.webRoot ?? path.resolve("dist/web");
  if (existsSync(webRoot)) {
    app.use(express.static(webRoot, { index: false, fallthrough: true }));
    app.get("*splat", (_request, response) =>
      response.sendFile(path.join(webRoot, "index.html")),
    );
  }

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (response.headersSent) return;
      if (error instanceof DomainError) {
        response.status(error.status).json({ error: error.code });
        return;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        response.status(413).json({ error: "request_too_large" });
        return;
      }
      console.error("P9 request failed", { error: "internal_error" });
      response.status(500).json({ error: "internal_error" });
    },
  );
  return { app, auth };
}
