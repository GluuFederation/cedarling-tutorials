export const personaIds = ["dana", "amir", "eve"] as const;
export type PersonaId = (typeof personaIds)[number];

export const incidentStatuses = [
  "open",
  "investigating",
  "mitigated",
  "resolved",
] as const;
export type IncidentStatus = (typeof incidentStatuses)[number];

export type Incident = Readonly<{
  id: string;
  title: string;
  status: IncidentStatus;
  assignedTo: PersonaId | null;
  severity: "medium" | "high" | "critical";
  version: number;
}>;

export function isPersona(value: unknown): value is PersonaId {
  return (
    typeof value === "string" && personaIds.some((persona) => persona === value)
  );
}

export function parsePersona(value: string | undefined): PersonaId {
  if (isPersona(value)) return value;
  throw new Error("Choose one P3 account: dana, amir, or eve");
}
