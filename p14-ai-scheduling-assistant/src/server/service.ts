import { randomUUID } from "node:crypto";
import { type ToolDefinition, toolCatalog } from "../shared/tool-catalog.ts";
import type {
  ExecutionResult,
  Meeting,
  Proposal,
  ToolArguments,
  User,
  Workspace,
} from "../shared/types.ts";
import type {
  AuthorizationPort,
  AuthorizationRequest,
} from "./authorization.ts";
import type { AppDatabase, Session, StoredProposal } from "./database.ts";
import { AppError } from "./errors.ts";
import { planRequest, requestsFor } from "./simulator.ts";
import {
  findTool,
  groundToolIntent,
  proposalDisplay,
  validateToolArguments,
} from "./tools.ts";

const directContext = {
  assistantId: "cedarschedule",
  assistantMediated: false,
} as const;

export class SchedulingService {
  private readonly database: AppDatabase;
  private readonly authorization: AuthorizationPort;

  constructor(database: AppDatabase, authorization: AuthorizationPort) {
    this.database = database;
    this.authorization = authorization;
  }

  async workspace(
    session: Session,
    requestId: string = randomUUID(),
    context: AuthorizationRequest["context"] = directContext,
  ): Promise<Workspace> {
    const meetings: Meeting[] = [];
    for (const meeting of this.database.listMeetings()) {
      if (
        await this.allowMeeting(
          session,
          meeting,
          toolCatalog.list_meetings,
          requestId,
          context,
        )
      )
        meetings.push(meeting);
    }
    return {
      meetings,
      requests: requestsFor(session.user.id.replace(/^user-/u, "")),
    };
  }

  async propose(
    session: Session,
    input: { requestId: string; meetingId?: string },
    requestId: string = randomUUID(),
  ): Promise<Proposal> {
    const planned = planRequest(
      session.user.id.replace(/^user-/u, ""),
      input.requestId,
    );
    let selectedMeeting: Meeting | undefined;
    const requiresMeeting =
      planned.tool === "reschedule_meeting" ||
      planned.tool === "cancel_meeting";
    if (requiresMeeting && input.meetingId) {
      selectedMeeting = this.database.findMeeting(input.meetingId);
      if (
        !selectedMeeting ||
        !(await this.allowMeeting(
          session,
          selectedMeeting,
          toolCatalog.list_meetings,
          requestId,
        ))
      )
        throw new AppError("MEETING_NOT_FOUND", 404);
    }
    findTool(planned.tool);
    const args = groundToolIntent(planned, this.database, selectedMeeting);
    const targetMeeting = meetingIdFrom(args)
      ? this.database.findMeeting(meetingIdFrom(args) as string)
      : undefined;
    if (meetingIdFrom(args) && !targetMeeting)
      throw new AppError("MEETING_NOT_FOUND", 404);
    if (
      targetMeeting &&
      !(await this.allowMeeting(
        session,
        targetMeeting,
        toolCatalog.list_meetings,
        requestId,
      ))
    )
      throw new AppError("MEETING_NOT_FOUND", 404);
    const stored = this.database.createProposal({
      sessionHash: session.idHash,
      userId: session.user.id,
      tool: planned.tool,
      arguments: args,
    });
    const display = proposalDisplay(planned.tool, args, targetMeeting);
    const room =
      typeof args.roomId === "string"
        ? this.database.listRooms().find((item) => item.id === args.roomId)
        : undefined;
    return {
      id: stored.id,
      version: stored.version,
      tool: planned.tool,
      action: toolCatalog[planned.tool].label,
      target: room?.name ?? display.target,
      summary: display.summary,
      expiresAt: new Date(stored.expiresAt).toISOString(),
      source: "Deterministic assistant simulator",
    };
  }

  async execute(
    session: Session,
    proposalId: string,
    proposalVersion: number,
    requestId: string = randomUUID(),
  ): Promise<ExecutionResult> {
    const proposal = this.database.getProposal(
      proposalId,
      session.user.id,
      session.idHash,
    );
    if (!proposal) throw new AppError("PROPOSAL_NOT_FOUND", 404);
    if (proposal.status === "consumed" && proposal.result)
      return { ...proposal.result, replayed: true };
    if (proposal.expiresAt <= Date.now())
      throw new AppError("PROPOSAL_EXPIRED", 409, "Request a new proposal.");
    if (proposal.version !== proposalVersion)
      throw new AppError("STALE_PROPOSAL", 409);
    const tool = findTool(proposal.tool);
    const args = validateToolArguments(proposal.tool, proposal.arguments);

    if (proposal.tool === "list_meetings") {
      const meetings = (
        await this.workspace(session, requestId, assistantContext(proposalId))
      ).meetings;
      return this.complete(
        proposalId,
        session,
        proposal,
        proposalVersion,
        () => ({
          message: `Found ${meetings.length} meeting${meetings.length === 1 ? "" : "s"}.`,
          meetings,
        }),
      );
    }
    if (proposal.tool === "find_availability") {
      for (const userId of args.userIds as string[]) {
        const user = this.database.findUserById(userId);
        if (!user) throw new AppError("USER_NOT_FOUND", 404);
        await this.requireAllow(session, {
          requestId,
          capability: tool.capability,
          action: tool.action,
          resourceId: user.id,
          facts: { targetKind: user.kind, requestedDays: args.days },
          context: assistantContext(proposalId),
        });
      }
      const slots = this.database.availability(
        args.userIds as string[],
        Number(args.days),
      );
      return this.complete(
        proposalId,
        session,
        proposal,
        proposalVersion,
        () => ({
          message: `Found ${slots.length} shared slots.`,
          slots,
        }),
      );
    }

    if (proposal.tool === "schedule_meeting") {
      const room = this.database
        .listRooms()
        .find((item) => item.id === args.roomId);
      if (!room) throw new AppError("ROOM_NOT_FOUND", 404);
      await this.requireAllow(session, {
        requestId,
        capability: tool.capability,
        action: tool.action,
        resourceId: room.id,
        facts: {
          actorKind: session.user.kind,
          roomAccessClass: room.accessClass,
          attendeeIds: args.attendeeIds,
          startAt: args.startAt,
          endAt: args.endAt,
        },
        context: assistantContext(proposalId),
      });
      return this.complete(
        proposalId,
        session,
        proposal,
        proposalVersion,
        () => {
          const meeting = this.database.schedule(session.user.id, args);
          return { message: `${meeting.title} was scheduled.`, meeting };
        },
      );
    }

    const meetingId = meetingIdFrom(args);
    const meeting = meetingId
      ? this.database.findMeeting(meetingId)
      : undefined;
    if (!meeting) throw new AppError("MEETING_NOT_FOUND", 404);
    const targetRoom =
      proposal.tool === "reschedule_meeting"
        ? this.database
            .listRooms()
            .find((room) => room.id === String(args.roomId))
        : undefined;
    if (proposal.tool === "reschedule_meeting" && !targetRoom)
      throw new AppError("ROOM_NOT_FOUND", 404);
    await this.requireAllow(session, {
      requestId,
      capability: tool.capability,
      action: tool.action,
      resourceId: meeting.id,
      facts: {
        ...meetingFacts(this.database, session.user, meeting, tool.capability),
        ...(targetRoom
          ? {
              targetRoomId: targetRoom.id,
              targetRoomAccessClass: targetRoom.accessClass,
              startAt: args.startAt,
              endAt: args.endAt,
            }
          : {}),
      },
      context: assistantContext(proposalId),
    });
    return this.complete(proposalId, session, proposal, proposalVersion, () => {
      const changed =
        proposal.tool === "reschedule_meeting"
          ? this.database.reschedule(args)
          : this.database.cancel(args);
      return {
        message:
          proposal.tool === "reschedule_meeting"
            ? `${changed.title} was rescheduled.`
            : `${changed.title} was cancelled.`,
        meeting: changed,
      };
    });
  }

  private complete(
    id: string,
    session: Session,
    proposal: StoredProposal,
    version: number,
    effect: () => Omit<ExecutionResult, "proposalId" | "replayed">,
  ): ExecutionResult {
    return this.database.completeProposal(
      id,
      session.user.id,
      session.idHash,
      version,
      proposal.digest,
      effect,
    );
  }

  private async allowMeeting(
    session: Session,
    meeting: Meeting,
    tool: ToolDefinition,
    requestId: string,
    context: AuthorizationRequest["context"] = directContext,
  ): Promise<boolean> {
    return this.authorization.authorize({
      requestId,
      capability: tool.capability,
      action: tool.action,
      principalId: session.user.id,
      resourceId: meeting.id,
      accessToken: session.accessToken,
      facts: meetingFacts(
        this.database,
        session.user,
        meeting,
        tool.capability,
      ),
      context,
    });
  }

  private async requireAllow(
    session: Session,
    request: Omit<AuthorizationRequest, "principalId" | "accessToken">,
  ): Promise<void> {
    const allowed = await this.authorization.authorize({
      ...request,
      principalId: session.user.id,
      accessToken: session.accessToken,
    });
    if (!allowed)
      throw new AppError("FORBIDDEN", 403, "This action is not allowed.");
  }
}

function assistantContext(proposalId: string): AuthorizationRequest["context"] {
  return {
    assistantId: "cedarschedule",
    assistantMediated: true,
    proposalId,
  };
}

function meetingIdFrom(args: ToolArguments): string | undefined {
  return typeof args.meetingId === "string" ? args.meetingId : undefined;
}

function meetingFacts(
  database: AppDatabase,
  user: User,
  meeting: Meeting,
  operation: string,
): Readonly<Record<string, unknown>> {
  return {
    organizerId: meeting.organizerId,
    actorIsOrganizer: meeting.organizerId === user.id,
    actorIsAttendee: meeting.attendeeIds.includes(user.id),
    actorKind: user.kind,
    roomAccessClass: meeting.room.accessClass,
    classification: meeting.classification,
    status: meeting.status,
    version: meeting.version,
    ...database.delegationFacts(user.id, meeting.id, operation),
  };
}
