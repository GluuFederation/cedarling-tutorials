import type {
  MemberView,
  MessageView,
  RoomSnapshot,
} from "../shared/protocol.ts";

type RoomContent = Readonly<{
  members: readonly MemberView[];
  messages: readonly MessageView[];
}>;

export type RoomState = Readonly<Record<string, RoomContent>>;

export const emptyRoom: RoomContent = { members: [], messages: [] };

function mergeMessages(
  current: readonly MessageView[],
  incoming: readonly MessageView[],
): MessageView[] {
  const messages = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) messages.set(item.id, item);
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}

export function applySnapshot(
  current: RoomState,
  snapshot: RoomSnapshot,
): RoomState {
  return {
    ...current,
    [snapshot.room.id]: {
      members: snapshot.members,
      messages: mergeMessages(
        current[snapshot.room.id]?.messages ?? [],
        snapshot.messages,
      ),
    },
  };
}

export function applyMessage(
  current: RoomState,
  message: MessageView,
): RoomState {
  const room = current[message.roomId] ?? emptyRoom;
  return {
    ...current,
    [message.roomId]: {
      ...room,
      messages: mergeMessages(room.messages, [message]),
    },
  };
}

export function applyMembership(
  current: RoomState,
  roomId: string,
  membership: MemberView,
): RoomState {
  const room = current[roomId] ?? emptyRoom;
  return {
    ...current,
    [roomId]: {
      ...room,
      members: room.members.map((item) =>
        item.userId === membership.userId ? membership : item,
      ),
    },
  };
}
