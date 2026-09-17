import type { Incident } from "./types.js";

export const runbookUri = "runbook://incident-response/core";

export const runbookText = `Incident response
1. Confirm the current incident status and assignment.
2. Record the observation before changing state.
3. Advance exactly one lifecycle step.
4. Verify the protected effect and correlation ID.`;

export function triagePrompt(incident: Incident): string {
  return [
    `Triage ${incident.id}: ${incident.title}.`,
    `Current status: ${incident.status}; severity: ${incident.severity}.`,
    "Summarize the immediate observation, the next safe check, and whether a status change is justified.",
  ].join("\n");
}
