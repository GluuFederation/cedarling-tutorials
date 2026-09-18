import type {
  AccessDeletion,
  AccessUpdate,
  CommentCreation,
  DocumentCreation,
  DocumentDetail,
  DocumentSummary,
  DocumentUpdate,
  Session,
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
      .catch(() => ({ error: "request_failed" }))) as { error?: string };
    throw new ApiError(response.status, body.error ?? "request_failed");
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

const documentPath = (id: string) => `/api/documents/${encodeURIComponent(id)}`;

export const api = {
  session: () => request<Session>("/api/session"),
  documents: () =>
    request<{ documents: DocumentSummary[]; createAllowed: boolean }>(
      "/api/documents",
    ),
  document: (id: string) => request<DocumentDetail>(documentPath(id)),
  createDocument: (input: DocumentCreation, csrf: string) =>
    request<{ document: DocumentSummary }>(
      "/api/documents",
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  updateDocument: (id: string, input: DocumentUpdate, csrf: string) =>
    request<DocumentDetail>(
      documentPath(id),
      { method: "PATCH", body: JSON.stringify(input) },
      csrf,
    ),
  addComment: (id: string, input: CommentCreation, csrf: string) =>
    request<void>(
      `${documentPath(id)}/comments`,
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  setAccess: (id: string, userId: string, input: AccessUpdate, csrf: string) =>
    request<DocumentDetail>(
      `${documentPath(id)}/access/${encodeURIComponent(userId)}`,
      { method: "PUT", body: JSON.stringify(input) },
      csrf,
    ),
  removeAccess: (
    id: string,
    userId: string,
    input: AccessDeletion,
    csrf: string,
  ) =>
    request<DocumentDetail>(
      `${documentPath(id)}/access/${encodeURIComponent(userId)}`,
      { method: "DELETE", body: JSON.stringify(input) },
      csrf,
    ),
  logout: (csrf: string) =>
    request<void>("/auth/logout", { method: "POST" }, csrf),
};
