import { createRequestHandler } from "@react-router/express";
import type { Express } from "express";
import express from "express";
import { RouterContextProvider, type ServerBuild } from "react-router";
import { requestServicesContext } from "../app/context.ts";
import { createOidcRuntime } from "./auth/oidc.ts";
import { SessionManager } from "./auth/session.ts";
import { loadConfig } from "./config/environment.ts";
import { AppDatabase } from "./data/database.ts";
import { RequestService } from "./http/requests.ts";
import { PermissiveAuthorizationGateway } from "./workspace/capabilities.ts";
import { WorkspaceService } from "./workspace/service.ts";

const runtimeKey = Symbol.for("p11.runtime");
type Resources = Awaited<ReturnType<typeof createResources>>;
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: Promise<Resources> };

async function createResources() {
  const config = loadConfig();
  const database = new AppDatabase(config.databaseUrl);
  try {
    await database.initialize(config.issuer);
    const oidc = await createOidcRuntime(config);
    return {
      config,
      pool: database.pool,
      oidc,
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}

const globalRuntime = globalThis as RuntimeGlobal;
if (!globalRuntime[runtimeKey]) {
  const pending = createResources();
  globalRuntime[runtimeKey] = pending;
  void pending.catch(() => {
    if (globalRuntime[runtimeKey] === pending) delete globalRuntime[runtimeKey];
  });
}
const resources = await globalRuntime[runtimeKey];
// Preserve connections, not old class instances, when Vite reloads server code.
const database = new AppDatabase(resources.pool);
const authorization = new PermissiveAuthorizationGateway();
const sessions = new SessionManager(resources.config, database, resources.oidc);

export const app: Express = express();
app.use(
  createRequestHandler({
    build: () =>
      import(
        "virtual:react-router/server-build"
      ) as unknown as Promise<ServerBuild>,
    getLoadContext(_request, response) {
      const context = new RouterContextProvider();
      const workspace = new WorkspaceService(
        database,
        authorization,
        resources.config.sessionSecret,
      );
      const requestId = String(response.locals.requestId);
      context.set(requestServicesContext, {
        database,
        sessions,
        workspace,
        requests: new RequestService(sessions, workspace, requestId),
        requestId,
        nonce: String(response.locals.nonce),
      });
      return context;
    },
  }),
);

export async function closeRuntime(): Promise<void> {
  const active = globalRuntime[runtimeKey];
  delete globalRuntime[runtimeKey];
  if (active) await (await active).pool.end();
}
