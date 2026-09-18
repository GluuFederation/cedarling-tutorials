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
  classification: "internal" | "restricted";
  version: number;
}>;

export function parsePersona(value: string | undefined): PersonaId {
  if (value === "dana" || value === "amir" || value === "eve") return value;
  throw new Error("Choose one P3 account: dana, amir, or eve");
}
