import type {
  DraftInput,
  GradeView,
  Publication,
  SessionView,
} from "../shared/contracts.ts";
export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string;
  readonly code: string;
  constructor(
    status: number,
    message: string,
    requestId = "",
    code = "REQUEST_FAILED",
  ) {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if (init.signal?.aborted || !(error instanceof TypeError)) throw error;
    throw new ApiError(
      503,
      "The request could not be confirmed. Check your connection.",
      "",
      "REQUEST_UNCONFIRMED",
    );
  }
  const requestId = response.headers.get("x-request-id") ?? "";
  console.info(
    "P13 browser | HTTP " +
      response.status +
      " | " +
      (init.method ?? "GET") +
      " " +
      path.split("?")[0] +
      " | " +
      (requestId || "unavailable"),
  );
  if (response.status === 204) return undefined as T;
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? 502 : response.status,
      "The server returned an unreadable response. Retry the request.",
      requestId,
      response.ok ? "REQUEST_UNCONFIRMED" : "REQUEST_FAILED",
    );
  }
  if (!response.ok) {
    const body = value as { message?: string; error?: string };
    throw new ApiError(
      response.status,
      body.message ?? "The request failed. Try again.",
      requestId,
      body.error,
    );
  }
  return value as T;
}
const mutation = (
  method: string,
  csrf: string,
  body?: unknown,
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const api = {
  session: (signal?: AbortSignal) =>
    request<SessionView>("/api/session", signal ? { signal } : {}),
  logout: (csrf: string) =>
    request<void>("/auth/logout", mutation("POST", csrf)),
  save: (id: string, input: DraftInput, csrf: string, signal?: AbortSignal) =>
    request<GradeView>(`/api/grades/${encodeURIComponent(id)}`, {
      ...mutation("PATCH", csrf, input),
      ...(signal ? { signal } : {}),
    }),
  publish: (
    id: string,
    expectedVersion: number,
    csrf: string,
    signal?: AbortSignal,
  ) =>
    request<Publication>(`/api/grades/${encodeURIComponent(id)}/publish`, {
      ...mutation("POST", csrf, { expectedVersion }),
      ...(signal ? { signal } : {}),
    }),
};
