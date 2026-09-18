import {
  type ToolDefinition,
  type ToolName,
  toolCatalog,
} from "../shared/tool-catalog.ts";
import type { Meeting, ToolArguments } from "../shared/types.ts";
import type { AppDatabase } from "./database.ts";
import { AppError } from "./errors.ts";
import type { PlannedTool } from "./simulator.ts";

export function findTool(name: unknown): ToolDefinition {
  if (typeof name !== "string" || !Object.hasOwn(toolCatalog, name))
    throw new AppError(
      "INVALID_PROPOSAL",
      422,
      "The assistant selected an unknown tool.",
    );
  return toolCatalog[name as ToolName];
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === expected[index])
  );
}
const string = (value: unknown, max = 200) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const iso = (value: unknown) =>
  string(value) && Number.isFinite(Date.parse(value as string));
const stringArray = (value: unknown, max: number, min = 0) =>
  Array.isArray(value) &&
  value.length >= min &&
  value.length <= max &&
  value.every((item) => string(item, 80));

export function validateToolArguments(
  name: ToolName,
  value: unknown,
): ToolArguments {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_PROPOSAL", 422);
  const args = value as Record<string, unknown>;
  let valid = false;
  if (name === "list_meetings") valid = exact(args, []);
  if (name === "find_availability")
    valid =
      exact(args, ["days", "userIds"]) &&
      stringArray(args.userIds, 20, 1) &&
      Number.isSafeInteger(args.days) &&
      Number(args.days) >= 1 &&
      Number(args.days) <= 14;
  if (name === "schedule_meeting")
    valid =
      exact(args, ["attendeeIds", "endAt", "roomId", "startAt", "title"]) &&
      string(args.title, 100) &&
      stringArray(args.attendeeIds, 20) &&
      string(args.roomId, 80) &&
      iso(args.startAt) &&
      iso(args.endAt) &&
      Date.parse(args.endAt as string) > Date.parse(args.startAt as string);
  if (name === "reschedule_meeting")
    valid =
      exact(args, [
        "endAt",
        "expectedVersion",
        "meetingId",
        "roomId",
        "startAt",
      ]) &&
      string(args.meetingId, 80) &&
      string(args.roomId, 80) &&
      iso(args.startAt) &&
      iso(args.endAt) &&
      Date.parse(args.endAt as string) > Date.parse(args.startAt as string) &&
      Number.isSafeInteger(args.expectedVersion) &&
      Number(args.expectedVersion) >= 1;
  if (name === "cancel_meeting")
    valid =
      exact(args, ["expectedVersion", "meetingId"]) &&
      string(args.meetingId, 80) &&
      Number.isSafeInteger(args.expectedVersion) &&
      Number(args.expectedVersion) >= 1;
  if (!valid)
    throw new AppError(
      "INVALID_PROPOSAL",
      422,
      "The assistant produced invalid executable arguments.",
    );
  return Object.freeze({ ...args });
}

export function groundToolIntent(
  plan: PlannedTool,
  database: AppDatabase,
  selectedMeeting?: Meeting,
): ToolArguments {
  const intent = plan.intent as Record<string, unknown>;
  if (plan.tool === "list_meetings") {
    requireExactIntent(intent, []);
    return {};
  }
  if (plan.tool === "find_availability") {
    requireExactIntent(intent, ["days", "participantNames"]);
    if (
      !stringArray(intent.participantNames, 20, 1) ||
      !Number.isSafeInteger(intent.days) ||
      Number(intent.days) < 1 ||
      Number(intent.days) > 14
    )
      invalidIntent();
    return validateToolArguments(plan.tool, {
      userIds: (intent.participantNames as string[]).map(
        (name) => resolveUser(database, name).id,
      ),
      days: intent.days,
    });
  }
  if (plan.tool === "schedule_meeting") {
    requireExactIntent(intent, ["attendeeNames", "roomName", "title"]);
    if (
      !string(intent.title, 100) ||
      !stringArray(intent.attendeeNames, 20) ||
      !string(intent.roomName, 80)
    )
      invalidIntent();
    const room = resolveRoom(database, intent.roomName as string);
    const window = database.suggestedWindow();
    return validateToolArguments(plan.tool, {
      title: intent.title,
      attendeeIds: (intent.attendeeNames as string[]).map(
        (name) => resolveUser(database, name).id,
      ),
      roomId: room.id,
      startAt: window.startAt,
      endAt: window.endAt,
    });
  }
  const meeting = requireMeeting(selectedMeeting);
  if (plan.tool === "reschedule_meeting") {
    requireExactIntent(intent, ["offsetMinutes", "roomName"]);
    if (
      !string(intent.roomName, 80) ||
      !Number.isSafeInteger(intent.offsetMinutes) ||
      Number(intent.offsetMinutes) < 15 ||
      Number(intent.offsetMinutes) > 8 * 60
    )
      invalidIntent();
    const room = resolveRoom(database, intent.roomName as string);
    const offset = Number(intent.offsetMinutes) * 60_000;
    return validateToolArguments(plan.tool, {
      meetingId: meeting.id,
      roomId: room.id,
      startAt: new Date(Date.parse(meeting.startAt) + offset).toISOString(),
      endAt: new Date(Date.parse(meeting.endAt) + offset).toISOString(),
      expectedVersion: meeting.version,
    });
  }
  requireExactIntent(intent, []);
  return validateToolArguments(plan.tool, {
    meetingId: meeting.id,
    expectedVersion: meeting.version,
  });
}

function requireExactIntent(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (!exact(value, keys)) invalidIntent();
}

function invalidIntent(): never {
  throw new AppError(
    "INVALID_ASSISTANT_INTENT",
    422,
    "The assistant produced invalid intent.",
  );
}

function requireMeeting(meeting?: Meeting): Meeting {
  if (!meeting)
    throw new AppError("MEETING_REQUIRED", 422, "Select a meeting first.");
  return meeting;
}

function resolveUser(database: AppDatabase, name: string) {
  const matches = database.findUsersByName(name);
  if (matches.length !== 1)
    throw new AppError(
      "ASSISTANT_RESOURCE_UNAVAILABLE",
      422,
      "The requested participant is unavailable or ambiguous.",
    );
  return matches[0] as NonNullable<(typeof matches)[number]>;
}

function resolveRoom(database: AppDatabase, name: string) {
  const matches = database.listRooms().filter((room) => room.name === name);
  if (matches.length !== 1)
    throw new AppError(
      "ASSISTANT_RESOURCE_UNAVAILABLE",
      422,
      "The requested room is unavailable or ambiguous.",
    );
  return matches[0] as NonNullable<(typeof matches)[number]>;
}

export function proposalDisplay(
  tool: ToolName,
  args: ToolArguments,
  meeting?: Meeting,
): { target: string; summary: string } {
  if (tool === "list_meetings")
    return {
      target: "Meeting list",
      summary: "List meetings available to you",
    };
  if (tool === "find_availability")
    return {
      target: "Selected calendars",
      summary: "Find shared availability next week",
    };
  if (tool === "schedule_meeting")
    return {
      target: String(args.roomId),
      summary: `Schedule ${String(args.title)}`,
    };
  if (tool === "reschedule_meeting")
    return {
      target: meeting?.title ?? "Selected meeting",
      summary: "Move the meeting one hour later",
    };
  return {
    target: meeting?.title ?? "Selected meeting",
    summary: "Cancel the selected meeting",
  };
}
