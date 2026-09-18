import type { Capability } from "./capabilities.ts";

export type { Capability } from "./capabilities.ts";

export const realtimeEvents = {
  client: {
    enterRoom: "room:enter",
    publishMessage: "message:publish",
    removeMember: "member:remove",
    deleteMessage: "message:delete",
  },
  server: {
    roomSnapshot: "room:snapshot",
    messageCreated: "message:created",
    membershipRemoved: "membership:removed",
    messageDeleted: "message:deleted",
    operationError: "operation:error",
  },
} as const;

export const clientEvents = Object.values(realtimeEvents.client);

export type OperationOutcome = Readonly<{
  requestId: string;
  capability: Capability;
  resource: string;
  decision: "FAKE ALLOW" | "UNAVAILABLE";
  effect: string;
  reason: "permissive_allow" | "authorization_unavailable";
}>;

export type RoomView = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  version: number;
}>;

export type MemberView = Readonly<{
  userId: string;
  name: string;
  role: "member" | "moderator";
  active: boolean;
  version: number;
}>;

export type MessageView = Readonly<{
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  content: string | null;
  sequence: number;
  version: number;
  deleted: boolean;
  createdAt: string;
}>;

export type RoomSnapshot = Readonly<{
  room: RoomView;
  members: readonly MemberView[];
  messages: readonly MessageView[];
  nextSequence: number;
  hasMore: boolean;
  replayed: boolean;
  outcome: OperationOutcome;
}>;

export type PublishResult = Readonly<{
  message: MessageView;
  duplicate: boolean;
  outcome: OperationOutcome;
}>;

export type RemoveResult = Readonly<{
  roomId: string;
  membership: MemberView;
  duplicate: boolean;
  outcome: OperationOutcome;
}>;

export type DeleteResult = Readonly<{
  message: MessageView;
  duplicate: boolean;
  outcome: OperationOutcome;
}>;

type OperationError = Readonly<{
  code: string;
  message: string;
  requestId?: string;
}>;

export type Ack<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: OperationError }>;

export type EnterInput = Readonly<{
  roomId: string;
  lastSequence: number;
}>;

export type PublishInput = Readonly<{
  roomId: string;
  commandId: string;
  content: string;
}>;

export type RemoveInput = Readonly<{
  roomId: string;
  userId: string;
  commandId: string;
  expectedVersion: number;
}>;

export type DeleteInput = Readonly<{
  roomId: string;
  messageId: string;
  commandId: string;
  expectedVersion: number;
}>;

export interface ClientToServerEvents {
  [realtimeEvents.client.enterRoom]: (
    input: EnterInput,
    ack: (result: Ack<RoomSnapshot>) => void,
  ) => void;
  [realtimeEvents.client.publishMessage]: (
    input: PublishInput,
    ack: (result: Ack<PublishResult>) => void,
  ) => void;
  [realtimeEvents.client.removeMember]: (
    input: RemoveInput,
    ack: (result: Ack<RemoveResult>) => void,
  ) => void;
  [realtimeEvents.client.deleteMessage]: (
    input: DeleteInput,
    ack: (result: Ack<DeleteResult>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  [realtimeEvents.server.roomSnapshot]: (snapshot: RoomSnapshot) => void;
  [realtimeEvents.server.messageCreated]: (event: PublishResult) => void;
  [realtimeEvents.server.membershipRemoved]: (event: RemoveResult) => void;
  [realtimeEvents.server.messageDeleted]: (event: DeleteResult) => void;
  [realtimeEvents.server.operationError]: (error: OperationError) => void;
}

export type SessionView = Readonly<{
  user: Readonly<{ id: string; name: string }>;
  rooms: readonly RoomView[];
  csrfToken: string;
  expiresAt: string;
  authzMode: "permissive";
}>;
