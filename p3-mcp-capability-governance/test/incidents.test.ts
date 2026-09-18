import { describe, expect, it } from "vitest";
import { IncidentRepository } from "../src/incidents/repository.js";

describe("incident lifecycle", () => {
  it("advances one step and applies an idempotent effect once", () => {
    const incidents = new IncidentRepository();
    const input = {
      incidentId: "INC-1001",
      expectedStatus: "open" as const,
      nextStatus: "investigating" as const,
      idempotencyKey: "effect-one",
    };
    const first = incidents.updateStatus(input);
    const replay = incidents.updateStatus(input);
    expect(first).toEqual(replay);
    expect(first.version).toBe(2);
  });

  it("rejects skipped, stale, and conflicting idempotent mutations", () => {
    const incidents = new IncidentRepository();
    expect(() =>
      incidents.updateStatus({
        incidentId: "INC-1001",
        expectedStatus: "open",
        nextStatus: "mitigated",
        idempotencyKey: "skip-step",
      }),
    ).toThrow("invalid_incident_transition");
    incidents.updateStatus({
      incidentId: "INC-1001",
      expectedStatus: "open",
      nextStatus: "investigating",
      idempotencyKey: "first-step",
    });
    expect(() =>
      incidents.updateStatus({
        incidentId: "INC-1001",
        expectedStatus: "open",
        nextStatus: "investigating",
        idempotencyKey: "stale-step",
      }),
    ).toThrow("stale_incident_state");
    expect(() =>
      incidents.updateStatus({
        incidentId: "INC-1002",
        expectedStatus: "investigating",
        nextStatus: "mitigated",
        idempotencyKey: "first-step",
      }),
    ).toThrow("idempotency_conflict");
  });
});
