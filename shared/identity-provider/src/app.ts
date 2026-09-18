import express, { type Express } from "express";
import type Provider from "oidc-provider";

export function createApp(provider: Provider): Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.use(provider.callback());
  return app;
}
