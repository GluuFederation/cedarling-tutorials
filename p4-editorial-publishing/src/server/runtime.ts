import { BaselineAuthorizationGateway } from "./authorization.ts";
import { loadConfig, prepareDataDirectory } from "./config.ts";
import { AppDatabase } from "./database.ts";
import { createOidcRuntime } from "./oidc.ts";
import { EditorialService } from "./service.ts";
import { SessionManager } from "./session.ts";

const runtimeKey = Symbol.for("p4.cedarpress.runtime");
type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: Promise<Runtime> };

async function createRuntime() {
  const config = loadConfig();
  prepareDataDirectory(config.dataDirectory);
  const database = new AppDatabase(config.dataDirectory, config.issuer);
  try {
    const oidc = await createOidcRuntime(config);
    const authorization = new BaselineAuthorizationGateway();
    return {
      config,
      database,
      sessions: new SessionManager(config, database, oidc),
      editorial: new EditorialService(database, authorization),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

const root = globalThis as RuntimeGlobal;
export function runtime(): Promise<Runtime> {
  root[runtimeKey] ??= createRuntime();
  return root[runtimeKey];
}
