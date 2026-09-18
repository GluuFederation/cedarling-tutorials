import type {
  InspectionSubmission,
  Reassignment,
  Session,
  WorkOrder,
  WorkOrderCreation,
  WorkOrderDeletion,
  WorkOrderDetail,
} from "../shared/types.ts";

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
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (csrf) headers.set("x-csrf-token", csrf);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
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
  workOrders: () =>
    request<{ workOrders: WorkOrder[]; createAllowed: boolean }>(
      "/api/work-orders",
    ),
  createWorkOrder: (input: WorkOrderCreation, csrf: string) =>
    request<{ workOrder: WorkOrder }>(
      "/api/work-orders",
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  workOrder: (id: string) =>
    request<WorkOrderDetail>(`/api/work-orders/${encodeURIComponent(id)}`),
  submit: (id: string, input: InspectionSubmission, csrf: string) =>
    request<{ workOrder: WorkOrder; replayed: boolean }>(
      `/api/work-orders/${encodeURIComponent(id)}/inspections`,
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  reassign: (id: string, input: Reassignment, csrf: string) =>
    request<{ workOrder: WorkOrder }>(
      `/api/work-orders/${encodeURIComponent(id)}/reassignment`,
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  deleteWorkOrder: (id: string, input: WorkOrderDeletion, csrf: string) =>
    request<void>(
      `/api/work-orders/${encodeURIComponent(id)}`,
      { method: "DELETE", body: JSON.stringify(input) },
      csrf,
    ),
  logout: (csrf: string) =>
    request<void>("/auth/logout", { method: "POST" }, csrf),
};
