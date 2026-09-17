import type { Resource, ResourceDetails, Session } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function responseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new ApiError(response.status, body.error ?? "request_failed");
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw await responseError(response);
  return (await response.json()) as T;
}

function mutation(
  method: string,
  csrfToken: string,
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export const api = {
  session: () => json<Session>("/api/session"),
  list: (parentId?: string) =>
    json<{ folder: Resource | null; resources: Resource[] }>(
      `/api/resources${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`,
    ),
  details: (id: string) => json<ResourceDetails>(`/api/resources/${id}`),
  async content(id: string): Promise<Blob> {
    const response = await fetch(`/api/resources/${id}/content`);
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },
  createFolder: (parentId: string, name: string, csrfToken: string) =>
    json<{ resource: Resource }>(
      "/api/folders",
      mutation("POST", csrfToken, { parentId, name }),
    ),
  upload: (parentId: string, file: File, csrfToken: string) =>
    json<{ resource: Resource }>(
      `/api/files?parentId=${encodeURIComponent(parentId)}&name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-CSRF-Token": csrfToken,
        },
        body: file,
      },
    ),
  replace: (resource: Resource, bytes: Blob, csrfToken: string) =>
    json<{ resource: Resource }>(
      `/api/resources/${resource.id}/content?version=${resource.version}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-CSRF-Token": csrfToken,
        },
        body: bytes,
      },
    ),
  share: (
    resource: Resource,
    userId: string,
    role: "viewer" | "editor",
    csrfToken: string,
  ) =>
    json<{ resource: Resource }>(
      `/api/resources/${resource.id}/shares`,
      mutation("POST", csrfToken, {
        version: resource.version,
        userId,
        role,
      }),
    ),
  revoke: (resource: Resource, userId: string, csrfToken: string) =>
    json<{ resource: Resource }>(
      `/api/resources/${resource.id}/shares/${encodeURIComponent(userId)}`,
      mutation("DELETE", csrfToken, { version: resource.version }),
    ),
  move: (resource: Resource, destinationId: string, csrfToken: string) =>
    json<{ resource: Resource }>(
      `/api/resources/${resource.id}/move`,
      mutation("POST", csrfToken, {
        version: resource.version,
        destinationId,
      }),
    ),
  delete: (resource: Resource, csrfToken: string) =>
    json<{ deleted: true; count: number }>(
      `/api/resources/${resource.id}`,
      mutation("DELETE", csrfToken, { version: resource.version }),
    ),
  async logout(csrfToken: string): Promise<void> {
    const response = await fetch("/auth/logout", mutation("POST", csrfToken));
    if (!response.ok) throw await responseError(response);
  },
};
