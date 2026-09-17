import { createRequestHandler } from "@react-router/express";
import express from "express";
import type { Express } from "express";
import { RouterContextProvider, type ServerBuild } from "react-router";
import { requestServicesContext } from "../app/context.ts";
import { PermissiveAuthorizationGateway } from "../src/server/capabilities.ts";
import { loadConfig } from "../src/server/config.ts";
import { AppDatabase } from "../src/server/database.ts";
import { createOidcRuntime } from "../src/server/oidc.ts";
import { SessionManager } from "../src/server/session.ts";
import { WorkspaceService } from "../src/server/service.ts";

const runtimeKey = Symbol.for("p11.runtime");
type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: Promise<Runtime> };

async function createRuntime() {
  const config = loadConfig();
  const database = new AppDatabase(config.databaseUrl);
  try {
    await database.migrate();
    const oidc = await createOidcRuntime(config);
    const authorization = new PermissiveAuthorizationGateway();
    return {
      config,
      database,
      sessions: new SessionManager(config, database, oidc),
      workspace: new WorkspaceService(
        database,
        authorization,
        config.sessionSecret,
      ),
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}

const globalRuntime = globalThis as RuntimeGlobal;
if (!globalRuntime[runtimeKey]) {
  globalRuntime[runtimeKey] = createRuntime();
}
const runtime = await globalRuntime[runtimeKey];

export const app: Express = express();
app.use(
  createRequestHandler({
    build: () =>
      import(
        "virtual:react-router/server-build"
      ) as unknown as Promise<ServerBuild>,
    getLoadContext(_request, response) {
      const context = new RouterContextProvider();
      context.set(requestServicesContext, {
        ...runtime,
        requestId: String(response.locals.requestId),
        nonce: String(response.locals.nonce),
      });
      return context;
    },
  }),
);

export async function closeRuntime(): Promise<void> {
  const active = globalRuntime[runtimeKey];
  delete globalRuntime[runtimeKey];
  if (active) await (await active).database.close();
}
