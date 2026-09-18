import type { AssistantRequest } from "../shared/types.ts";
import { AppError } from "./errors.ts";

export type PlannedTool =
  | Readonly<{ tool: "list_meetings"; intent: Readonly<Record<never, never>> }>
  | Readonly<{
      tool: "find_availability";
      intent: Readonly<{ participantNames: readonly string[]; days: number }>;
    }>
  | Readonly<{
      tool: "schedule_meeting";
      intent: Readonly<{
        title: string;
        attendeeNames: readonly string[];
        roomName: string;
      }>;
    }>
  | Readonly<{
      tool: "reschedule_meeting";
      intent: Readonly<{ roomName: string; offsetMinutes: number }>;
    }>
  | Readonly<{
      tool: "cancel_meeting";
      intent: Readonly<Record<never, never>>;
    }>;

type RequestDefinition = AssistantRequest &
  Readonly<{
    subjects: readonly string[];
    plan: PlannedTool;
  }>;

const everyone = ["dina", "amara", "benoit", "chloe"] as const;

const requestCatalog = [
  {
    id: "list-meetings",
    label: "Refresh my meetings",
    requiresMeeting: false,
    subjects: everyone,
    plan: { tool: "list_meetings", intent: {} },
  },
  {
    id: "find-launch-availability",
    label: "Find availability for Dina and Benoit next week",
    requiresMeeting: false,
    subjects: ["dina"],
    plan: {
      tool: "find_availability",
      intent: { participantNames: ["Dina", "Benoit"], days: 7 },
    },
  },
  {
    id: "reschedule-selected",
    label: "Move the selected meeting one hour later to Focus Room",
    requiresMeeting: true,
    subjects: ["dina", "amara", "benoit"],
    plan: {
      tool: "reschedule_meeting",
      intent: { roomName: "Focus Room", offsetMinutes: 60 },
    },
  },
  {
    id: "cancel-selected",
    label: "Cancel the selected meeting",
    requiresMeeting: true,
    subjects: ["dina", "amara"],
    plan: { tool: "cancel_meeting", intent: {} },
  },
  {
    id: "schedule-vendor-welcome",
    label: "Schedule Vendor follow-up with Chloe in Welcome Room",
    requiresMeeting: false,
    subjects: ["chloe"],
    plan: {
      tool: "schedule_meeting",
      intent: {
        title: "Vendor follow-up",
        attendeeNames: ["Chloe"],
        roomName: "Welcome Room",
      },
    },
  },
  {
    id: "schedule-vendor-atlas",
    label: "Schedule Vendor follow-up with Chloe in Atlas Boardroom",
    requiresMeeting: false,
    subjects: ["chloe"],
    plan: {
      tool: "schedule_meeting",
      intent: {
        title: "Vendor follow-up",
        attendeeNames: ["Chloe"],
        roomName: "Atlas Boardroom",
      },
    },
  },
] as const satisfies readonly RequestDefinition[];

export function requestsFor(subject: string): readonly AssistantRequest[] {
  return requestCatalog
    .filter((request) =>
      request.subjects.some((candidate) => candidate === subject),
    )
    .map(({ id, label, requiresMeeting }) => ({ id, label, requiresMeeting }));
}

export function planRequest(subject: string, requestId: string): PlannedTool {
  const request = requestCatalog.find(
    (candidate) =>
      candidate.id === requestId &&
      candidate.subjects.some((allowed) => allowed === subject),
  );
  if (!request)
    throw new AppError(
      "ASSISTANT_REQUEST_UNAVAILABLE",
      404,
      "Choose one of the available assistant requests.",
    );
  return structuredClone(request.plan);
}
