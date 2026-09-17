import type {
  CatalogResult,
  OrderListResult,
  OrderMutationResult,
  ProjectionIntent,
  RefundListResult,
  RefundMutationResult,
  RefundViewResult,
  SessionView,
} from "../shared/protocol.ts";

type Failure = { error?: { code?: string }; requestId?: string };
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reference: string,
  ) {
    super(code);
  }
}
async function payload<T>(response: Response): Promise<T> {
  const value = (await response.json()) as T & Failure;
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.error?.code ?? "REQUEST_FAILED",
      value.requestId ?? "unknown",
    );
  return value;
}
const get = <T>(path: string) =>
  fetch(path, { cache: "no-store" }).then(payload<T>);
const post = <T>(path: string, body: object, csrfToken: string) =>
  fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  }).then(payload<T>);

export async function loadSession(): Promise<SessionView | null> {
  const response = await fetch("/api/session", { cache: "no-store" });
  return response.status === 401 ? null : payload<SessionView>(response);
}
export const loadCatalog = () => get<CatalogResult>("/api/catalog");
export const loadOrders = () => get<OrderListResult>("/api/orders");
export const createOrder = (
  bookId: string,
  expectedVersion: number,
  csrf: string,
) =>
  post<OrderMutationResult>("/api/orders", { bookId, expectedVersion }, csrf);
export const loadRefunds = () => get<RefundListResult>("/api/refunds");
export const loadRefund = (caseId: string, section: ProjectionIntent) =>
  get<RefundViewResult>(
    `/api/refunds/${encodeURIComponent(caseId)}?section=${section}`,
  );
export const mutateRefund = (
  caseId: string,
  path: "request" | "approval" | "fraud-review",
  body: object,
  csrfToken: string,
) =>
  post<RefundMutationResult>(
    `/api/refunds/${encodeURIComponent(caseId)}/${path}`,
    body,
    csrfToken,
  );
