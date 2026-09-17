import { afterEach, describe, expect, it } from "vitest";
import type {
  AuthorizationPort,
  AuthorizationRequest,
} from "../src/server/authorization.ts";
import type { Session } from "../src/server/database.ts";
import { SchedulingService } from "../src/server/service.ts";
import { testDatabase } from "./support.ts";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function fixture(
  subject = "benoit",
  authorize: AuthorizationPort["authorize"] = async () => true,
) {
  const opened = testDatabase();
  cleanup = opened.cleanup;
  const user = opened.database.findUser(subject);
  if (!user) throw new Error(`missing ${subject}`);
  const session: Session = {
    idHash: "session",
    user,
    accessToken: "signed-token",
    csrfToken: "csrf",
  };
  return {
    database: opened.database,
    session,
    service: new SchedulingService(opened.database, { authorize }),
  };
}

async function propose(
  service: SchedulingService,
  session: Session,
  requestId: string,
  meetingId?: string,
) {
  return service.propose(session, {
    requestId,
    ...(meetingId ? { meetingId } : {}),
  });
}

const gapCases = [
  {
    name: "attendee reschedule",
    subject: "benoit",
    requestId: "reschedule-selected",
    meetingId: "meeting-launch",
    capability: "meeting.reschedule",
    facts: { actorIsAttendee: true },
  },
  {
    name: "contractor employee-room booking",
    subject: "chloe",
    requestId: "schedule-vendor-atlas",
    meetingId: undefined,
    capability: "meeting.schedule",
    facts: { actorKind: "contractor", roomAccessClass: "employee" },
  },
  {
    name: "revoked-delegation cancellation",
    subject: "amara",
    requestId: "cancel-selected",
    meetingId: "meeting-leadership",
    capability: "meeting.cancel",
    facts: { delegationStatus: "revoked" },
  },
] as const;

const positiveCases = [
  {
    name: "organizer reschedule",
    subject: "dina",
    requestId: "reschedule-selected",
    meetingId: "meeting-launch",
    capability: "meeting.reschedule",
    facts: { actorIsOrganizer: true },
  },
  {
    name: "active delegated reschedule",
    subject: "amara",
    requestId: "reschedule-selected",
    meetingId: "meeting-launch",
    capability: "meeting.reschedule",
    facts: { delegationStatus: "active" },
  },
  {
    name: "contractor visitor-room booking",
    subject: "chloe",
    requestId: "schedule-vendor-welcome",
    meetingId: undefined,
    capability: "meeting.schedule",
    facts: { actorKind: "contractor", roomAccessClass: "visitor" },
  },
] as const;

describe("scheduling service", () => {
  it.each(gapCases)("reproduces the $name gap", async (scenario) => {
    const requests: AuthorizationRequest[] = [];
    const { service, session } = fixture(scenario.subject, async (request) => {
      requests.push(request);
      return true;
    });
    const proposal = await propose(
      service,
      session,
      scenario.requestId,
      scenario.meetingId,
    );
    await expect(
      service.execute(session, proposal.id, proposal.version),
    ).resolves.toMatchObject({ replayed: false });
    expect(requests.at(-1)).toMatchObject({
      capability: scenario.capability,
      facts: scenario.facts,
      context: {
        assistantId: "cedarschedule",
        assistantMediated: true,
        proposalId: proposal.id,
      },
    });
  });

  it.each(positiveCases)("allows the $name control", async (scenario) => {
    const requests: AuthorizationRequest[] = [];
    const { service, session } = fixture(scenario.subject, async (request) => {
      requests.push(request);
      return true;
    });
    const proposal = await propose(
      service,
      session,
      scenario.requestId,
      scenario.meetingId,
    );
    await service.execute(session, proposal.id, proposal.version);
    expect(requests.at(-1)).toMatchObject({
      capability: scenario.capability,
      facts: scenario.facts,
    });
  });

  it("performs no effect and leaves the proposal pending after denial", async () => {
    const { database, service, session } = fixture(
      "benoit",
      async (request) => request.capability === "meeting.read",
    );
    const proposal = await propose(
      service,
      session,
      "reschedule-selected",
      "meeting-launch",
    );
    await expect(
      service.execute(session, proposal.id, proposal.version),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database.findMeeting("meeting-launch")?.version).toBe(1);
    expect(
      database.getProposal(proposal.id, session.user.id, session.idHash),
    ).toMatchObject({ status: "pending", version: 1 });
  });

  it("rejects a tampered ID and stale proposal version without an effect", async () => {
    const { database, service, session } = fixture();
    const proposal = await propose(service, session, "list-meetings");
    await expect(
      service.execute(session, `${proposal.id}-tampered`, proposal.version),
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
    await expect(
      service.execute(session, proposal.id, proposal.version + 1),
    ).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    expect(
      database.getProposal(proposal.id, session.user.id, session.idHash),
    ).toMatchObject({ status: "pending", version: 1 });
  });

  it("returns only independently authorized meetings from an assistant read", async () => {
    const { service, session } = fixture(
      "dina",
      async (request) => request.resourceId === "meeting-launch",
    );
    const proposal = await propose(service, session, "list-meetings");
    await expect(
      service.execute(session, proposal.id, proposal.version),
    ).resolves.toMatchObject({
      meetings: [{ id: "meeting-launch" }],
      message: "Found 1 meeting.",
    });
  });

  it("returns the stored result when a confirmed proposal is replayed", async () => {
    const { database, service, session } = fixture();
    const proposal = await propose(
      service,
      session,
      "reschedule-selected",
      "meeting-launch",
    );
    const first = await service.execute(session, proposal.id, proposal.version);
    const replay = await service.execute(
      session,
      proposal.id,
      proposal.version,
    );
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      replayed: true,
      proposalId: proposal.id,
      message: first.message,
    });
    expect(database.findMeeting("meeting-launch")?.version).toBe(2);
  });
});
