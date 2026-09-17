import type { ToolName } from "./tool-catalog.ts";

export type UserKind = "employee" | "contractor";
export type User = Readonly<{
  id: string;
  name: string;
  role: string;
  kind: UserKind;
}>;

export type Room = Readonly<{
  id: string;
  name: string;
  accessClass: "employee" | "visitor";
  capacity: number;
}>;

export type Meeting = Readonly<{
  id: string;
  title: string;
  organizerId: string;
  organizerName: string;
  attendeeIds: readonly string[];
  attendeeNames: readonly string[];
  room: Room;
  classification: "internal" | "confidential" | "external";
  startAt: string;
  endAt: string;
  status: "scheduled" | "cancelled";
  version: number;
}>;

export type ToolArguments = Readonly<Record<string, unknown>>;

export type AssistantRequest = Readonly<{
  id: string;
  label: string;
  requiresMeeting: boolean;
}>;

export type Proposal = Readonly<{
  id: string;
  version: number;
  tool: ToolName;
  action: string;
  target: string;
  summary: string;
  expiresAt: string;
  source: "Deterministic assistant simulator";
}>;

export type SessionView = Readonly<{
  authenticated: boolean;
  user?: User;
  csrfToken?: string;
}>;

export type Workspace = Readonly<{
  meetings: readonly Meeting[];
  requests: readonly AssistantRequest[];
}>;

export type ExecutionResult = Readonly<{
  proposalId: string;
  replayed: boolean;
  message: string;
  meeting?: Meeting;
  meetings?: readonly Meeting[];
  slots?: readonly string[];
}>;
