import { existsSync } from "node:fs";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z } from "zod";
import { registerAuthRoutes } from "./auth-routes.ts";
import type { AppConfig } from "./config.ts";
import { randomToken } from "./crypto.ts";
import { DomainError } from "./errors.ts";
import type { OidcRuntime } from "./oidc.ts";
import { registerResourceRoutes } from "./resource-routes.ts";
import type { FileService } from "./service.ts";
import type { SessionStore } from "./session-store.ts";
import { InputError } from "./validation.ts";

type RequestWithId = Request & { requestId?: string };

export async function buildApp(
  options: Readonly<{
    config: AppConfig;
    sessions: SessionStore;
    service: FileService;
    oidc: OidcRuntime;
    webRoot?: string;
  }>,
): Promise<express.Express> {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
    }),
  );
  app.use((request: RequestWithId, response, next) => {
    request.requestId = randomToken(12);
    response.setHeader("X-Request-ID", request.requestId);
    next();
  });

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  const auth = registerAuthRoutes(
    app,
    options.config,
    options.sessions,
    options.oidc,
  );
  registerResourceRoutes(app, auth, options.service);

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
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
      if (error instanceof DomainError || error instanceof InputError) {
        response
          .status(error instanceof DomainError ? error.status : 400)
          .json({ error: error.code });
        return;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        response.status(413).json({ error: "file_too_large" });
        return;
      }
      console.error("P8 request failed", { error: "internal_error" });
      response.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}
