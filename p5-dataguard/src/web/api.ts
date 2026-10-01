import type {
  ActionAvailability,
  AuthorizationPreview,
  DatasetField,
  ExportCreated,
  QueryPlan,
  QueryResponse,
  SessionResponse,
} from "../shared/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function browserTrace(
  operation: string,
  outcome: Readonly<{
    status: number | "network failure";
    requestId?: string | undefined;
    category?: string;
  }>,
): void {
  console.info(`P5 browser | ${operation}`, {
    event:
      typeof outcome.status === "number"
        ? "http.response"
        : "http.request.failed",
    operation,
    ...outcome,
  });
}

async function fetchResponse(
  operation: string,
  path: string,
  options: RequestInit = {},
  csrfToken?: string,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
  try {
    return await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    browserTrace(operation, {
      status: "network failure",
      category: "network_unavailable",
    });
    throw error;
  }
}

async function request<T>(
  operation: string,
  path: string,
  options: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  const response = await fetchResponse(operation, path, options, csrfToken);
  const body = (await response
    .json()
    .catch(() => ({ error: "request_failed" }))) as T & {
    error?: string;
    requestId?: string;
  };
  browserTrace(operation, {
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? body.requestId,
    ...(!response.ok ? { category: body.error ?? "request_failed" } : {}),
  });
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? "request_failed");
  }
  return body;
}

export const api = {
  availability: (
    input: AuthorizationPreview,
    csrf: string,
    signal: AbortSignal,
  ) =>
    request<ActionAvailability>(
      "authorization.preview",
      "/api/authorization",
      { method: "POST", body: JSON.stringify(input), signal },
      csrf,
    ),
  session: () => request<SessionResponse>("session.load", "/api/session"),
  dataset: () =>
    request<{
      requestId: string;
      dataset: { id: string; fields: DatasetField[] };
    }>("dataset.inspect", "/api/dataset"),
  query: (plan: QueryPlan, csrf: string) =>
    request<QueryResponse>(
      plan.kind === "rows" ? "data.query" : "data.aggregate",
      `/api/query/${plan.kind === "rows" ? "rows" : "aggregate"}`,
      { method: "POST", body: JSON.stringify(plan) },
      csrf,
    ),
  createExport: (plan: QueryPlan, csrf: string) =>
    request<ExportCreated & { requestId: string }>(
      "data.export",
      "/api/exports",
      { method: "POST", body: JSON.stringify(plan) },
      csrf,
    ),
  revokeExport: (id: string, csrf: string) =>
    request<{ export: ExportCreated["export"] }>(
      "export.revoke",
      `/api/exports/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
      csrf,
    ),
  async download(downloadRef: string, csrf: string): Promise<void> {
    const response = await fetchResponse(
      "export.download",
      "/api/exports/download",
      { method: "POST", body: JSON.stringify({ downloadRef }) },
      csrf,
    );
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => ({ error: "request_failed" }))) as { error?: string };
      browserTrace("export.download", {
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
        category: body.error ?? "request_failed",
      });
      throw new ApiError(response.status, body.error ?? "request_failed");
    }
    browserTrace("export.download", {
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "dataguard-export.csv";
    link.click();
    URL.revokeObjectURL(href);
  },
  async logout(csrf: string): Promise<void> {
    await request<unknown>(
      "session.logout",
      "/auth/logout",
      { method: "POST" },
      csrf,
    );
  },
};
