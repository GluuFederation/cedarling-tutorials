import { afterEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "../src/server/database.ts";
import { testDatabase } from "./support.ts";

let database: AppDatabase | undefined;
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  database = undefined;
  cleanup = undefined;
});

function useDatabase(): AppDatabase {
  const opened = testDatabase();
  database = opened.database;
  cleanup = opened.cleanup;
  return database;
}

describe("scheduling database", () => {
  it("seeds meetings, room classes, and active and revoked delegations", () => {
    const db = useDatabase();
    expect(db.listMeetings().map((meeting) => meeting.title)).toEqual([
      "Launch Review",
      "Leadership Sync",
      "Vendor Onboarding",
    ]);
    expect(db.listRooms().map((room) => room.accessClass)).toEqual([
      "employee",
      "employee",
      "visitor",
    ]);
    expect(
      db.delegationFacts("user-amara", "meeting-launch", "meeting.reschedule"),
    ).toMatchObject({ delegationStatus: "active" });
    expect(
      db.delegationFacts("user-amara", "meeting-leadership", "meeting.cancel"),
    ).toMatchObject({ delegationStatus: "revoked" });
  });

  it("consumes a proposal with its effect exactly once", () => {
    const db = useDatabase();
    const proposal = db.createProposal({
      sessionHash: "session",
      userId: "user-dina",
      tool: "cancel_meeting",
      arguments: { meetingId: "meeting-launch", expectedVersion: 1 },
    });
    const stored = db.getProposal(proposal.id, "user-dina", "session");
    if (!stored) throw new Error("missing proposal");
    const first = db.completeProposal(
      proposal.id,
      "user-dina",
      "session",
      1,
      stored.digest,
      () => ({ message: "done" }),
    );
    const replay = db.completeProposal(
      proposal.id,
      "user-dina",
      "session",
      1,
      stored.digest,
      () => ({ message: "wrong" }),
    );
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, message: "done" });
  });

  it("rejects a stale meeting mutation", () => {
    const db = useDatabase();
    expect(() =>
      db.cancel({ meetingId: "meeting-launch", expectedVersion: 99 }),
    ).toThrow(/State changed/u);
    expect(db.findMeeting("meeting-launch")?.status).toBe("scheduled");
  });

  it("rejects an expired proposal before running its effect", () => {
    const db = useDatabase();
    const proposal = db.createProposal({
      sessionHash: "session",
      userId: "user-dina",
      tool: "list_meetings",
      arguments: {},
      now: 1_000,
    });
    const stored = db.getProposal(proposal.id, "user-dina", "session");
    if (!stored) throw new Error("missing proposal");
    let called = false;
    expect(() =>
      db.completeProposal(
        proposal.id,
        "user-dina",
        "session",
        proposal.version,
        stored.digest,
        () => {
          called = true;
          return { message: "unexpected" };
        },
        proposal.expiresAt + 1,
      ),
    ).toThrow(/new proposal/u);
    expect(called).toBe(false);
  });

  it("returns conflict-free availability for the requested users", () => {
    const db = useDatabase();
    const slots = db.availability(["user-dina", "user-benoit"], 7);
    expect(slots).toHaveLength(2);
    for (const startAt of slots) {
      const start = Date.parse(startAt);
      const conflicts = db.listMeetings().filter((meeting) => {
        const involvesRequestedUser =
          meeting.organizerId === "user-dina" ||
          meeting.organizerId === "user-benoit" ||
          meeting.attendeeIds.includes("user-dina") ||
          meeting.attendeeIds.includes("user-benoit");
        return (
          involvesRequestedUser &&
          meeting.status === "scheduled" &&
          Date.parse(meeting.startAt) < start + 3_600_000 &&
          Date.parse(meeting.endAt) > start
        );
      });
      expect(conflicts).toEqual([]);
    }
  });
});
