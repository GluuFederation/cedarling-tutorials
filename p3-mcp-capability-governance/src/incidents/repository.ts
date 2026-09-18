import { DomainError } from "./errors.js";
import type { Incident, IncidentStatus } from "./types.js";

const seed: readonly Incident[] = [
  {
    id: "INC-1001",
    title: "Payment API elevated errors",
    status: "open",
    assignedTo: "amir",
    severity: "critical",
    classification: "restricted",
    version: 1,
  },
  {
    id: "INC-1002",
    title: "Notification queue delay",
    status: "investigating",
    assignedTo: "amir",
    severity: "high",
    classification: "internal",
    version: 1,
  },
  {
    id: "INC-2001",
    title: "Audit export latency",
    status: "mitigated",
    assignedTo: null,
    severity: "medium",
    classification: "internal",
    version: 1,
  },
];

const nextStatus = new Map<IncidentStatus, IncidentStatus>([
  ["open", "investigating"],
  ["investigating", "mitigated"],
  ["mitigated", "resolved"],
]);

type Mutation = Readonly<{
  incidentId: string;
  expectedStatus: IncidentStatus;
  nextStatus: IncidentStatus;
}>;

export class IncidentRepository {
  readonly #incidents = new Map(
    seed.map((incident) => [incident.id, incident]),
  );
  readonly #effects = new Map<
    string,
    Readonly<{ mutation: Mutation; incident: Incident }>
  >();

  get(id: string): Incident {
    const incident = this.#incidents.get(id);
    if (!incident) throw new DomainError("incident_not_found");
    return incident;
  }

  search(query: string, limit: number): Incident[] {
    // A retried effect must repeat the original mutation exactly; the key
    // cannot be reused to apply different incident input.
    const normalized = query.toLowerCase();
    return [...this.#incidents.values()]
      .filter((incident) =>
        [incident.id, incident.title, incident.status].some((value) =>
          value.toLowerCase().includes(normalized),
        ),
      )
      .slice(0, limit);
  }

  updateStatus(
    input: Mutation & Readonly<{ idempotencyKey: string }>,
  ): Incident {
    const mutation: Mutation = {
      incidentId: input.incidentId,
      expectedStatus: input.expectedStatus,
      nextStatus: input.nextStatus,
    };
    const prior = this.#effects.get(input.idempotencyKey);
    if (prior) {
      if (JSON.stringify(prior.mutation) !== JSON.stringify(mutation)) {
        throw new DomainError("idempotency_conflict");
      }
      return prior.incident;
    }

    const current = this.get(input.incidentId);
    if (current.status !== input.expectedStatus) {
      throw new DomainError("stale_incident_state");
    }
    if (nextStatus.get(current.status) !== input.nextStatus) {
      throw new DomainError("invalid_incident_transition");
    }
    const updated: Incident = {
      ...current,
      status: input.nextStatus,
      version: current.version + 1,
    };
    this.#incidents.set(updated.id, updated);
    this.#effects.set(input.idempotencyKey, { mutation, incident: updated });
    return updated;
  }
}
