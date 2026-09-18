import { afterEach, describe, expect, it } from "vitest";
import {
  type PlannedTool,
  planRequest,
  requestsFor,
} from "../src/server/simulator.ts";
import {
  groundToolIntent,
  validateToolArguments,
} from "../src/server/tools.ts";
import { testDatabase } from "./support.ts";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function database() {
  const opened = testDatabase();
  cleanup = opened.cleanup;
  return opened.database;
}

describe("assistant simulator", () => {
  it("exposes only the requests available to the current persona", () => {
    expect(requestsFor("benoit").map((request) => request.id)).toEqual([
      "list-meetings",
      "reschedule-selected",
    ]);
    expect(requestsFor("chloe").map((request) => request.id)).toEqual([
      "list-meetings",
      "schedule-vendor-welcome",
      "schedule-vendor-atlas",
    ]);
  });

  it("produces resource-name intent without trusted IDs or versions", () => {
    const plan = planRequest("benoit", "reschedule-selected");
    expect(plan).toEqual({
      tool: "reschedule_meeting",
      intent: { roomName: "Focus Room", offsetMinutes: 60 },
    });
    expect(JSON.stringify(plan)).not.toMatch(/user-|meeting-|expectedVersion/u);
  });

  it("grounds assistant intent with current server-owned resources", () => {
    const store = database();
    const meeting = store.findMeeting("meeting-launch");
    expect(meeting).toBeDefined();
    expect(
      groundToolIntent(
        planRequest("benoit", "reschedule-selected"),
        store,
        meeting,
      ),
    ).toMatchObject({
      meetingId: "meeting-launch",
      roomId: "room-focus",
      expectedVersion: 1,
    });
    expect(
      groundToolIntent(planRequest("chloe", "schedule-vendor-welcome"), store),
    ).toMatchObject({
      attendeeIds: ["user-chloe"],
      roomId: "room-welcome",
      title: "Vendor follow-up",
    });
  });

  it("rejects unavailable requests and unresolved resource names", () => {
    expect(() => planRequest("benoit", "cancel-selected")).toThrow(
      /available assistant requests/u,
    );
    const invalid: PlannedTool = {
      tool: "schedule_meeting",
      intent: {
        title: "Unknown attendee",
        attendeeNames: ["Nobody"],
        roomName: "Welcome Room",
      },
    };
    expect(() => groundToolIntent(invalid, database())).toThrow(
      /unavailable or ambiguous/u,
    );
  });

  it("rejects malformed executable arguments", () => {
    expect(() =>
      validateToolArguments("find_availability", { userIds: [], days: 7 }),
    ).toThrow(/invalid executable arguments/u);
  });
});
