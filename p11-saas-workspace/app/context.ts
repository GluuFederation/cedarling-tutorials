import { createContext, type RouterContextProvider } from "react-router";
import type { AppConfig } from "../src/server/config.ts";
import type { AppDatabase } from "../src/server/database.ts";
import type { SessionManager } from "../src/server/session.ts";
import type { WorkspaceService } from "../src/server/service.ts";

export type RequestServices = Readonly<{
  config: AppConfig;
  database: AppDatabase;
  sessions: SessionManager;
  workspace: WorkspaceService;
  requestId: string;
  nonce: string;
}>;

export const requestServicesContext = createContext<RequestServices>();

export function services(
  context: Readonly<RouterContextProvider>,
): RequestServices {
  return context.get(requestServicesContext);
}
