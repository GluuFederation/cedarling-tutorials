import type {
  Audience,
  DraftInput,
  GradeView,
  Publication,
  SessionView,
} from "../shared/contracts.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string;
  constructor(status: number, message: string, requestId: string) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    const status = response.status;
    const message =
      status === 401
        ? "Session expired. Choose an identity again."
        : status === 404
          ? "Grade not found or unavailable."
          : status === 409
            ? "The grade or its relationships changed. Reload and try again."
            : status === 503
              ? "Authorization unavailable. Try again."
              : status === 400 || status === 422
                ? "Check the grade fields before trying again."
                : "Request failed. Try again.";
    throw new ApiError(
      status,
      message,
      response.headers.get("x-request-id") ?? "",
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
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
  list: (audience: Audience, signal: AbortSignal) =>
    request<{ grades: GradeView[] }>(`/api/grades/${audience}`, { signal }),
  read: (audience: Audience, id: string, signal: AbortSignal) =>
    request<GradeView>(`/api/grades/${audience}/${encodeURIComponent(id)}`, {
      signal,
    }),
  save: (id: string, input: DraftInput, csrf: string) =>
    request<GradeView>(
      `/api/grades/${encodeURIComponent(id)}`,
      mutation("PATCH", csrf, input),
    ),
  publish: (id: string, expectedVersion: number, csrf: string) =>
    request<Publication>(
      `/api/grades/${encodeURIComponent(id)}/publish`,
      mutation("POST", csrf, { expectedVersion }),
    ),
};
