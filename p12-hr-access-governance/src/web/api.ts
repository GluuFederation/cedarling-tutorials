import type { Result } from "../shared/contracts.ts";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string, requestId = "") {
    super(message + (requestId ? ` (${requestId})` : ""));
    this.status = status;
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<Result<T>> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  let value: Result<T> & { error?: { code?: string; message?: string } };
  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "The server returned an unreadable response. Retry the request.",
      response.headers.get("x-request-id") ?? "",
    );
  }
  console.info(
    `P12 browser | HTTP ${response.status} | ${init.method ?? "GET"} ${path.split("?")[0]} | ${value.requestId ?? response.headers.get("x-request-id") ?? "unavailable"}`,
  );
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.error?.code ?? "REQUEST_FAILED",
      value.error?.message ?? "The request failed. Try again.",
      value.requestId,
    );
  return value;
}
export function mutate<T>(
  path: string,
  csrfToken: string,
  body: object,
  signal?: AbortSignal,
): Promise<Result<T>> {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}
