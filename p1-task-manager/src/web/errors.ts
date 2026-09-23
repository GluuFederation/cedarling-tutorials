import { ApiError } from "./api";

export function friendlyError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Task service unavailable. Retry.";
  if (error.status === 401) return "Session expired. Choose an identity again.";
  if (error.code === "stale_task_version")
    return "Task changed. Review the latest version and retry.";
  if (error.code === "invalid_task_transition")
    return "This task is already completed.";
  if (error.status === 404) return "Task unavailable.";
  if (error.status === 400) return "Check the task fields and retry.";
  if (error.code === "request_verification_failed")
    return "Request verification failed. Refresh and retry.";
  return "Task service unavailable. Retry.";
}
