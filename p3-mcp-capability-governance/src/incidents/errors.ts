export type DomainErrorCode =
  | "incident_not_found"
  | "stale_incident_state"
  | "invalid_incident_transition"
  | "idempotency_conflict";

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code);
    this.name = "DomainError";
  }
}
