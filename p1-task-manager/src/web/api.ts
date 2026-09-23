import type { Session, Task, TaskResult } from "./types";

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
  csrfToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
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
  tasks: () => request<{ tasks: Task[] }>("/api/tasks"),
  task: (id: string) =>
    request<TaskResult>(`/api/tasks/${encodeURIComponent(id)}`),
  create: (input: { title: string; description: string }, csrf: string) =>
    request<TaskResult>(
      "/api/tasks",
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  edit: (
    task: Task,
    input: { title: string; description: string },
    csrf: string,
  ) =>
    request<TaskResult>(
      `/api/tasks/${encodeURIComponent(task.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ ...input, version: task.version }),
      },
      csrf,
    ),
  assign: (task: Task, assigneeId: string, csrf: string) =>
    request<TaskResult>(
      `/api/tasks/${encodeURIComponent(task.id)}/assign`,
      {
        method: "POST",
        body: JSON.stringify({ assigneeId, version: task.version }),
      },
      csrf,
    ),
  complete: (task: Task, csrf: string) =>
    request<TaskResult>(
      `/api/tasks/${encodeURIComponent(task.id)}/complete`,
      { method: "POST", body: JSON.stringify({ version: task.version }) },
      csrf,
    ),
  delete: (task: Task, csrf: string) =>
    request<{ deleted: true }>(
      `/api/tasks/${encodeURIComponent(task.id)}`,
      { method: "DELETE", body: JSON.stringify({ version: task.version }) },
      csrf,
    ),
  logout: (csrf: string) =>
    request<undefined>("/auth/logout", { method: "POST" }, csrf),
};
