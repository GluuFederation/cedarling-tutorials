import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  Ack,
  ClientToServerEvents,
  DeleteInput,
  EnterInput,
  MemberView,
  MessageView,
  OperationOutcome,
  PublishInput,
  RemoveInput,
  RoomSnapshot,
  ServerToClientEvents,
} from "../shared/protocol.ts";
import { clientEvents, realtimeEvents } from "../shared/protocol.ts";
import type { AuthorizationGateway } from "./authorization.ts";
import type { AppConfig } from "./config.ts";
import { limits } from "./config.ts";
import { randomIdentifier } from "./crypto.ts";
import type { ChatRepository } from "./database.ts";
import { DomainError } from "./errors.ts";
import type { Membership, Message, Session } from "./models.ts";
import { RoomSerialExecutor } from "./serial-executor.ts";
import type { SessionStore } from "./session-store.ts";
import {
  deleteInput,
  enterInput,
  publishInput,
  removeInput,
} from "./validation.ts";

type SocketData = {
  sessionHash: string;
  userId: string;
  roomIds: Set<string>;
};

type ChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function messageView(value: Message): MessageView {
  return { ...value, createdAt: new Date(value.createdAt).toISOString() };
}

function memberView(
  value: Membership & { name?: string },
  fallbackName: string,
): MemberView {
  return {
    userId: value.userId,
    name: value.name ?? fallbackName,
    role: value.role,
    active: value.active,
    version: value.version,
  };
}

function failure(error: unknown): Ack<never> {
  if (error instanceof DomainError) {
    return { ok: false, error: { code: error.code, message: error.code } };
  }
  console.error("P9 realtime operation failed", { error: "internal_error" });
  return {
    ok: false,
    error: { code: "internal_error", message: "internal_error" },
  };
}

async function acknowledge<T>(
  ack: (result: Ack<T>) => void,
  operation: () => Promise<T>,
): Promise<void> {
  try {
    ack({ ok: true, value: await operation() });
  } catch (error) {
    ack(failure(error));
  }
}

class SlidingRate {
  readonly #events = new Map<string, number[]>();

  take(key: string, maximum: number, now = Date.now()): boolean {
    const current = (this.#events.get(key) ?? []).filter(
      (timestamp) => timestamp > now - limits.rateWindowMs,
    );
    if (current.length >= maximum) {
      this.#events.set(key, current);
      return false;
    }
    current.push(now);
    this.#events.set(key, current);
    return true;
  }
}

export function attachRealtime(
  httpServer: HttpServer,
  options: Readonly<{
    config: AppConfig;
    chat: ChatRepository;
    sessions: SessionStore;
    authorization: AuthorizationGateway;
  }>,
): { io: Server; close(): Promise<void> } {
  const expectedOrigin = new URL(options.config.baseUrl).origin;
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    allowRequest(request, callback) {
      callback(null, request.headers.origin === expectedOrigin);
    },
  });
  const socketsBySession = new Map<string, Set<ChatSocket>>();
  const socketsByUser = new Map<string, Set<ChatSocket>>();
  const roomSockets = new Map<string, Set<ChatSocket>>();
  const serial = new RoomSerialExecutor();
  const userRate = new SlidingRate();
  const roomRate = new SlidingRate();
  const knownEvents = new Set<string>(clientEvents);

  function add(
    index: Map<string, Set<ChatSocket>>,
    key: string,
    socket: ChatSocket,
  ): void {
    const values = index.get(key) ?? new Set<ChatSocket>();
    values.add(socket);
    index.set(key, values);
  }

  function remove(
    index: Map<string, Set<ChatSocket>>,
    key: string,
    socket: ChatSocket,
  ): void {
    const values = index.get(key);
    values?.delete(socket);
    if (values?.size === 0) index.delete(key);
  }

  function currentSession(socket: ChatSocket): Session {
    const session = options.sessions.getSessionByHash(
      socket.data.sessionHash,
      options.config,
    );
    if (!session || session.user.id !== socket.data.userId) {
      socket.emit(realtimeEvents.server.operationError, {
        code: "authentication_required",
        message: "Session expired or revoked",
      });
      socket.disconnect(true);
      throw new DomainError("authentication_required", 401);
    }
    return session;
  }

  function authorize(
    input: Parameters<AuthorizationGateway["evaluate"]>[0],
  ): OperationOutcome {
    const outcome = options.authorization.evaluate(input);
    if (outcome.decision !== "FAKE ALLOW") {
      throw new DomainError("authorization_unavailable", 503);
    }
    return outcome;
  }

  function* recipients(roomId: string): Generator<
    Readonly<{
      socket: ChatSocket;
      session: Session;
      membership: Membership | undefined;
    }>
  > {
    const candidates = [...(roomSockets.get(roomId) ?? [])].slice(
      0,
      limits.activeMembersPerRoom * limits.socketsPerUser,
    );
    for (const socket of candidates) {
      try {
        const session = currentSession(socket);
        yield {
          socket,
          session,
          membership: options.chat.membership(roomId, session.user.id),
        };
      } catch {
        // The current-session check already disconnects invalid candidates.
      }
    }
  }

  function deliverMessage(roomId: string, value: Message): void {
    for (const { socket, session, membership } of recipients(roomId)) {
      const outcome = options.authorization.evaluate({
        principalId: session.user.id,
        capability: "message.deliver",
        resourceId: value.id,
        facts: {
          roomId,
          membershipActive: membership?.active ?? false,
          membershipVersion: membership?.version ?? 0,
          sequence: value.sequence,
        },
        effect: "emit persisted message to one recipient socket",
      });
      if (outcome.decision === "FAKE ALLOW") {
        socket.emit(realtimeEvents.server.messageCreated, {
          message: messageView(value),
          duplicate: false,
          outcome,
        });
      }
    }
  }

  function deliverMembership(
    roomId: string,
    removed: Membership,
    fallbackName: string,
  ): void {
    for (const { socket, session, membership } of recipients(roomId)) {
      const outcome = options.authorization.evaluate({
        principalId: session.user.id,
        capability: "membership.deliver",
        resourceId: `${roomId}:${removed.userId}`,
        facts: {
          recipientMembershipActive: membership?.active ?? false,
          removedMembershipVersion: removed.version,
        },
        effect: "emit committed membership removal to one recipient socket",
      });
      if (outcome.decision === "FAKE ALLOW") {
        socket.emit(realtimeEvents.server.membershipRemoved, {
          roomId,
          membership: memberView(removed, fallbackName),
          duplicate: false,
          outcome,
        });
      }
    }
  }

  function deliverDeletion(roomId: string, value: Message): void {
    for (const { socket, session, membership } of recipients(roomId)) {
      const outcome = options.authorization.evaluate({
        principalId: session.user.id,
        capability: "message.deletion.deliver",
        resourceId: value.id,
        facts: {
          roomId,
          membershipActive: membership?.active ?? false,
          messageVersion: value.version,
        },
        effect: "emit committed message deletion to one recipient socket",
      });
      if (outcome.decision === "FAKE ALLOW") {
        socket.emit(realtimeEvents.server.messageDeleted, {
          message: messageView(value),
          duplicate: false,
          outcome,
        });
      }
    }
  }

  io.use((socket, next) => {
    const ticket = socket.handshake.auth.ticket;
    if (typeof ticket !== "string" || ticket.length > 128) {
      next(new Error("invalid_connection_ticket"));
      return;
    }
    const session = options.sessions.consumeTicket(ticket, options.config);
    if (!session) {
      next(new Error("invalid_connection_ticket"));
      return;
    }
    if (
      (socketsByUser.get(session.user.id)?.size ?? 0) >= limits.socketsPerUser
    ) {
      next(new Error("socket_limit_reached"));
      return;
    }
    const outcome = options.authorization.evaluate({
      principalId: session.user.id,
      capability: "chat.connect",
      resourceId: "chat:p9",
      facts: { sessionExpiresAt: session.expiresAt },
      effect: "activate one authenticated socket",
    });
    if (outcome.decision !== "FAKE ALLOW") {
      next(new Error("authorization_unavailable"));
      return;
    }
    socket.data = {
      sessionHash: session.idHash,
      userId: session.user.id,
      roomIds: new Set<string>(),
    };
    next();
  });

  io.on("connection", (socket) => {
    const typed = socket as ChatSocket;
    add(socketsBySession, typed.data.sessionHash, typed);
    add(socketsByUser, typed.data.userId, typed);
    const session = currentSession(typed);
    const expiryTimer = setTimeout(
      () => typed.disconnect(true),
      Math.max(0, session.expiresAt - Date.now()),
    );

    typed.onAny((event) => {
      if (!knownEvents.has(event)) {
        typed.emit(realtimeEvents.server.operationError, {
          code: "unknown_event",
          message: "Unknown realtime event",
        });
      }
    });

    typed.on(realtimeEvents.client.enterRoom, (raw: unknown, ack) => {
      void acknowledge(ack, async () => {
        const input: EnterInput = enterInput(raw);
        const result = await serial.run(input.roomId, () => {
          const current = currentSession(typed);
          const target = options.chat.room(input.roomId);
          if (!target) throw new DomainError("room_not_found", 404);
          if (
            !typed.data.roomIds.has(input.roomId) &&
            typed.data.roomIds.size >= limits.roomsPerSocket
          ) {
            throw new DomainError("room_limit_reached", 429);
          }
          const membership = options.chat.membership(
            input.roomId,
            current.user.id,
          );
          const outcome = authorize({
            principalId: current.user.id,
            capability: "room.enter",
            resourceId: target.id,
            facts: {
              roomTenantId: target.tenantId,
              principalTenantId: current.user.tenantId,
              membershipActive: membership?.active ?? false,
              membershipVersion: membership?.version ?? 0,
            },
            effect: "register room subscription and return bounded history",
          });
          typed.data.roomIds.add(input.roomId);
          add(roomSockets, input.roomId, typed);
          const page = options.chat.messagePageAfter(
            input.roomId,
            input.lastSequence,
          );
          const members = options.chat
            .members(input.roomId)
            .map((item) => memberView(item, item.name));
          const snapshot: RoomSnapshot = {
            room: {
              id: target.id,
              tenantId: target.tenantId,
              name: target.name,
              version: target.version,
            },
            members,
            messages: page.messages.map(messageView),
            nextSequence:
              page.messages[page.messages.length - 1]?.sequence ??
              input.lastSequence,
            hasMore: page.hasMore,
            replayed: input.lastSequence > 0,
            outcome,
          };
          return snapshot;
        });
        typed.emit(realtimeEvents.server.roomSnapshot, result);
        return result;
      });
    });

    typed.on(realtimeEvents.client.publishMessage, (raw: unknown, ack) => {
      void acknowledge(ack, async () => {
        const input: PublishInput = publishInput(raw);
        const result = await serial.run(input.roomId, async () => {
          const current = currentSession(typed);
          if (!typed.data.roomIds.has(input.roomId)) {
            throw new DomainError("room_not_entered", 409);
          }
          const target = options.chat.room(input.roomId);
          if (!target) throw new DomainError("room_not_found", 404);
          const member = options.chat.membership(input.roomId, current.user.id);
          const retry = options.chat.hasCommand(
            current.user.id,
            input.commandId,
            "publish",
            input,
          );
          if (
            !retry &&
            (!userRate.take(current.user.id, limits.userMessagesPerWindow) ||
              !roomRate.take(input.roomId, limits.roomMessagesPerWindow))
          ) {
            throw new DomainError("rate_limited", 429);
          }
          const outcome = authorize({
            principalId: current.user.id,
            capability: "message.publish",
            resourceId: target.id,
            facts: {
              membershipActive: member?.active ?? false,
              membershipRole: member?.role ?? "none",
              byteSize: Buffer.byteLength(input.content, "utf8"),
            },
            effect: "persist one message and room sequence",
          });
          const stored = options.chat.publish({
            ...input,
            userId: current.user.id,
            messageId: randomIdentifier("msg"),
            now: Date.now(),
          });
          if (!stored.duplicate) deliverMessage(input.roomId, stored.value);
          return {
            message: messageView(stored.value),
            duplicate: stored.duplicate,
            outcome,
          };
        });
        return result;
      });
    });

    typed.on(realtimeEvents.client.removeMember, (raw: unknown, ack) => {
      void acknowledge(ack, async () => {
        const input: RemoveInput = removeInput(raw);
        const result = await serial.run(input.roomId, async () => {
          const current = currentSession(typed);
          const actorMembership = options.chat.membership(
            input.roomId,
            current.user.id,
          );
          const target = options.chat.membership(input.roomId, input.userId);
          const targetUser = options.chat.findUserById(input.userId);
          if (!target || !targetUser) {
            throw new DomainError("membership_not_found", 404);
          }
          const outcome = authorize({
            principalId: current.user.id,
            capability: "member.remove",
            resourceId: `${input.roomId}:${input.userId}`,
            facts: {
              actorRole: actorMembership?.role ?? "none",
              actorMembershipActive: actorMembership?.active ?? false,
              targetVersion: target.version,
            },
            effect: "conditionally revoke room membership",
          });
          const stored = options.chat.removeMember({
            ...input,
            actorId: current.user.id,
            now: Date.now(),
          });
          if (!stored.duplicate) {
            deliverMembership(input.roomId, stored.value, targetUser.name);
          }
          return {
            roomId: input.roomId,
            membership: memberView(stored.value, targetUser.name),
            duplicate: stored.duplicate,
            outcome,
          };
        });
        return result;
      });
    });

    typed.on(realtimeEvents.client.deleteMessage, (raw: unknown, ack) => {
      void acknowledge(ack, async () => {
        const input: DeleteInput = deleteInput(raw);
        const result = await serial.run(input.roomId, async () => {
          const current = currentSession(typed);
          const actorMembership = options.chat.membership(
            input.roomId,
            current.user.id,
          );
          const target = options.chat.message(input.messageId);
          if (!target || target.roomId !== input.roomId) {
            throw new DomainError("message_not_found", 404);
          }
          const outcome = authorize({
            principalId: current.user.id,
            capability: "message.delete",
            resourceId: input.messageId,
            facts: {
              actorRole: actorMembership?.role ?? "none",
              actorMembershipActive: actorMembership?.active ?? false,
              authorMatches: target.authorId === current.user.id,
              messageVersion: target.version,
            },
            effect: "conditionally mark one message deleted",
          });
          const stored = options.chat.deleteMessage({
            ...input,
            actorId: current.user.id,
            now: Date.now(),
          });
          if (!stored.duplicate) deliverDeletion(input.roomId, stored.value);
          return {
            message: messageView(stored.value),
            duplicate: stored.duplicate,
            outcome,
          };
        });
        return result;
      });
    });

    typed.on("disconnect", () => {
      clearTimeout(expiryTimer);
      remove(socketsBySession, typed.data.sessionHash, typed);
      remove(socketsByUser, typed.data.userId, typed);
      for (const roomId of typed.data.roomIds)
        remove(roomSockets, roomId, typed);
    });
  });

  const unsubscribe = options.sessions.onRevoked((sessionHash) => {
    for (const socket of socketsBySession.get(sessionHash) ?? []) {
      socket.emit(realtimeEvents.server.operationError, {
        code: "session_revoked",
        message: "Session revoked",
      });
      socket.disconnect(true);
    }
  });

  return {
    io,
    async close() {
      unsubscribe();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
