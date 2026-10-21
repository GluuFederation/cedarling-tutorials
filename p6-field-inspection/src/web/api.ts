import { type Capability, capabilities } from "../shared/capabilities.ts";
import type {
  InspectionReview,
  InspectionSubmission,
  Reassignment,
  Session,
  WorkOrder,
  WorkOrderCreation,
  WorkOrderDeletion,
  WorkOrderDetail,
} from "../shared/types.ts";

export type RequestEvidence = Readonly<{
  requestId?: string | undefined;
  status?: number;
  capability?: Capability | undefined;
  decision?: "FAKE ALLOW" | "ALLOW" | "DENY" | undefined;
}>;
type ObserveRequest = (evidence: RequestEvidence) => void;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  csrf?: string,
  observe?: ObserveRequest,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (csrf) headers.set("x-csrf-token", csrf);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  }).catch((error: unknown) => {
    observe?.({});
    throw error;
  });
  const capability = response.headers.get("x-authorization-capability");
  const decision = response.headers.get("x-authorization-decision");
  observe?.({
    requestId: response.headers.get("x-request-id") ?? undefined,
    status: response.status,
    capability: Object.values(capabilities).includes(capability as Capability)
      ? (capability as Capability)
      : undefined,
    decision:
      decision === "FAKE ALLOW" || decision === "ALLOW" || decision === "DENY"
        ? decision
        : undefined,
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: "request_failed" }))) as {
      error?: string;
    };
    throw new ApiError(response.status, body.error ?? "request_failed");
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export const api = {
  session: () => request<Session>("/api/session"),
  workOrders: (offset = 0) =>
    request<{
      workOrders: WorkOrder[];
      createAllowed: boolean;
      nextOffset: number | null;
    }>(offset === 0 ? "/api/work-orders" : `/api/work-orders?offset=${offset}`),
  createWorkOrder: (
    input: WorkOrderCreation,
    csrf: string,
    observe?: ObserveRequest,
  ) =>
    request<{ workOrder: WorkOrder }>(
      "/api/work-orders",
      { method: "POST", body: JSON.stringify(input) },
      csrf,
      observe,
    ),
  workOrder: (id: string) =>
    request<WorkOrderDetail>(`/api/work-orders/${encodeURIComponent(id)}`),
  submit: (
    id: string,
    input: InspectionSubmission,
    csrf: string,
    observe?: ObserveRequest,
  ) =>
    request<{ workOrder: WorkOrder; replayed: boolean }>(
      `/api/work-orders/${encodeURIComponent(id)}/inspections`,
      { method: "POST", body: JSON.stringify(input) },
      csrf,
      observe,
    ),
  review: (
    id: string,
    input: InspectionReview,
    csrf: string,
    observe?: ObserveRequest,
  ) =>
    request<{ workOrder: WorkOrder; replayed: boolean }>(
      `/api/work-orders/${encodeURIComponent(id)}/review`,
      { method: "POST", body: JSON.stringify(input) },
      csrf,
      observe,
    ),
  reassign: (
    id: string,
    input: Reassignment,
    csrf: string,
    observe?: ObserveRequest,
  ) =>
    request<{ workOrder: WorkOrder }>(
      `/api/work-orders/${encodeURIComponent(id)}/reassignment`,
      { method: "POST", body: JSON.stringify(input) },
      csrf,
      observe,
    ),
  deleteWorkOrder: (
    id: string,
    input: WorkOrderDeletion,
    csrf: string,
    observe?: ObserveRequest,
  ) =>
    request<void>(
      `/api/work-orders/${encodeURIComponent(id)}`,
      { method: "DELETE", body: JSON.stringify(input) },
      csrf,
      observe,
    ),
  logout: (csrf: string) =>
    request<void>("/auth/logout", { method: "POST" }, csrf),
};
