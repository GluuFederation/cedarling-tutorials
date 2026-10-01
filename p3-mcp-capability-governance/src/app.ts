import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import type { NextFunction, Request, Response } from "express";
import type { P3Config } from "./config/project-config.js";
import { IncidentRepository } from "./incidents/repository.js";
import { createIncidentMcpServer } from "./mcp/server.js";
import { authorize } from "./mcp/authorization.js";

type AppDependencies = Readonly<{
  config: P3Config;
  tokenVerifier: OAuthTokenVerifier;
  incidents?: IncidentRepository;
  authorize?: typeof authorize;
}>;

export function createApp(dependencies: AppDependencies) {
  const { config } = dependencies;
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
    allowedOrigins: ["localhost", "127.0.0.1", "[::1]"],
    jsonLimit: "32kb",
  });
  app.disable("x-powered-by");
  const resourceUrl = new URL(config.mcpResource);
  const oauthMetadata: OAuthMetadata = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/auth`,
    token_endpoint: `${config.issuer}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "profile", "email", "mcp.access"],
  };
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: resourceUrl,
      scopesSupported: ["mcp.access"],
      resourceName: "P3 Incident Assistant",
      dangerouslyAllowInsecureIssuerUrl:
        new URL(config.issuer).protocol === "http:",
    }),
  );
  app.get("/health", (_request, response) =>
    response.json({
      status: "ok",
      service: "p3-mcp-capability-governance",
    }),
  );

  const incidents = dependencies.incidents ?? new IncidentRepository();
  const handler = createMcpHandler(
    ({ authInfo }) =>
      createIncidentMcpServer(authInfo, {
        incidents,
        authorize: dependencies.authorize ?? authorize,
      }),
    { legacy: "reject" },
  );
  const nodeHandler = toNodeHandler(handler);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  app.post(
    "/mcp",
    requireBearerAuth({
      verifier: dependencies.tokenVerifier,
      requiredScopes: ["mcp.access"],
      resourceMetadataUrl,
    }),
    (request: Request, response: Response, next: NextFunction) => {
      void nodeHandler(request, response, request.body).catch(next);
    },
  );

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (!response.headersSent) {
        // Body-parser failures are client errors; never expose their raw body or message.
        const parserType =
          error instanceof Error && "type" in error ? error.type : undefined;
        if (parserType === "entity.parse.failed") {
          response.status(400).json({ error: "invalid_request" });
          return;
        }
        if (parserType === "entity.too.large") {
          response.status(413).json({ error: "request_too_large" });
          return;
        }
        response.status(500).json({ error: "mcp_server_unavailable" });
      }
    },
  );
  return { app, close: () => handler.close() };
}
