import { createContext as createReactContext } from "react";
import { createContext } from "react-router";
import type { SessionManager } from "../server/auth/session.ts";
import type { AppDatabase } from "../server/data/database.ts";
import type { RequestService } from "../server/http/requests.ts";
import type { WorkspaceService } from "../server/workspace/service.ts";

export type RequestServices = Readonly<{
  database: AppDatabase;
  sessions: SessionManager;
  workspace: WorkspaceService;
  requests: RequestService;
  requestId: string;
  nonce: string;
}>;

export const requestServicesContext = createContext<RequestServices>();

export const DocumentNonceContext = createReactContext<string | undefined>(
  undefined,
);
