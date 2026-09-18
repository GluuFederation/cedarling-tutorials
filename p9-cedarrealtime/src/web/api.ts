import type { SessionView } from "../shared/protocol.ts";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `request_failed_${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadSession(): Promise<SessionView | undefined> {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (response.status === 401) return undefined;
  return json<SessionView>(response);
}

export async function connectionTicket(csrfToken: string): Promise<string> {
  const response = await fetch("/api/connection-ticket", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken },
  });
  return (await json<{ ticket: string }>(response)).ticket;
}

export async function logout(csrfToken: string): Promise<void> {
  const response = await fetch("/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) throw new Error("logout_failed");
}
