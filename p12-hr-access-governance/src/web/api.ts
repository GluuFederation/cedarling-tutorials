import { useCallback, useEffect, useRef, useState } from "react";
import type { Result } from "../shared/contracts.ts";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
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
  const value = (await response.json()) as Result<T> & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.error?.code ?? "REQUEST_FAILED",
      `${value.error?.message ?? "The request failed."}${value.requestId ? ` (${value.requestId})` : ""}`,
    );
  return value;
}
export function mutate<T>(
  path: string,
  csrfToken: string,
  body: object,
): Promise<Result<T>> {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
  });
}
export type Remote<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };
export function useRemote<T>(path: string | null, expired: () => void) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value: Remote<T> }>({
    key: "",
    value: { state: "loading" },
  });
  const key = `${path}:${revision}`;
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current;
    const controller = new AbortController();
    if (path)
      void api<T>(path, { signal: controller.signal })
        .then(({ data }) => {
          if (generation.current === id)
            setResult({ key, value: { state: "ready", data } });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || generation.current !== id) return;
          if (error instanceof ApiError && error.status === 401) expired();
          else
            setResult({
              key,
              value: {
                state: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Request failed. Try again.",
              },
            });
        });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [path, key, expired]);
  const remote: Remote<T> =
    result.key === key ? result.value : { state: "loading" };
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { result: remote, refresh };
}
