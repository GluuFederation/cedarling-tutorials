import type {
  ExecutionResult,
  Proposal,
  SessionView,
  Workspace,
} from "../shared/types.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    code: string,
    message?: string,
  ) {
    super(message ?? code);
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
      .catch(() => ({ error: "REQUEST_FAILED" }))) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      response.status,
      body.error ?? "REQUEST_FAILED",
      body.message,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export const api = {
  session: () => request<SessionView>("/api/session"),
  workspace: () => request<Workspace>("/api/workspace"),
  propose: (input: { requestId: string; meetingId?: string }, csrf: string) =>
    request<{ proposal: Proposal }>(
      "/api/assistant/proposals",
      { method: "POST", body: JSON.stringify(input) },
      csrf,
    ),
  execute: (proposal: Proposal, csrf: string) =>
    request<{ result: ExecutionResult }>(
      `/api/assistant/proposals/${encodeURIComponent(proposal.id)}/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          confirmed: true,
          proposalVersion: proposal.version,
        }),
      },
      csrf,
    ),
  logout: (csrf: string) =>
    request<void>("/auth/logout", { method: "POST" }, csrf),
};
