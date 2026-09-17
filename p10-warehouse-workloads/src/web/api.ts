import type { WorkloadId } from "../shared/catalog.ts";
import type { Transfer, WorkloadCommand, Workspace } from "../shared/types.ts";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new ApiError(body.error ?? "request_failed", response.status);
  return body;
}

export const api = {
  workspace: () => request<Workspace>("/api/workspace"),
  command: (workloadId: WorkloadId, command: WorkloadCommand) =>
    request<{
      transfer?: Transfer;
      inventory?: Workspace["inventory"];
      transfers?: Workspace["transfers"];
    }>(`/api/workloads/${workloadId}/commands`, {
      method: "POST",
      body: JSON.stringify(command),
    }),
};
