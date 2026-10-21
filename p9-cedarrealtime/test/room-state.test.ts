import { describe, expect, it } from "vitest";
import type {
  MemberView,
  MessageView,
  RoomSnapshot,
} from "../src/shared/protocol.ts";
import {
  applyMembership,
  applyMessage,
  applySnapshot,
} from "../src/web/room-state.ts";

const outcome = {
  requestId: "request-room-state",
  capability: "room.enter",
  resource: "room-a",
  decision: "FAKE ALLOW",
  effect: "test",
  reason: "permissive_allow",
} as const;

function snapshot(roomId: string, memberId: string): RoomSnapshot {
  return {
    room: { id: roomId, tenantId: "tenant-a", name: roomId, version: 1 },
    members: [
      {
        userId: memberId,
        name: memberId,
        role: "member",
        active: true,
        version: 1,
      },
    ],
    messages: [],
    nextSequence: 0,
    hasMore: false,
    replayed: false,
    outcome,
  };
}

function message(roomId: string, id: string): MessageView {
  return {
    id,
    roomId,
    authorId: "user-mei",
    authorName: "Mei",
    content: id,
    sequence: 1,
    version: 1,
    deleted: false,
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

describe("room-keyed realtime state", () => {
  it("preserves newer membership facts when an older event arrives", () => {
    const initial = snapshot("room-a", "user-mei");
    const original = initial.members[0];
    if (!original) throw new Error("Missing test membership");
    const removed = { ...original, active: false, version: 2 };
    let state = applySnapshot({}, initial);
    state = applyMembership(state, "room-a", removed);
    state = applyMembership(state, "room-a", original);
    expect(state["room-a"]?.members).toEqual([removed]);
  });

  it("does not resurrect a deleted message from an older replay", () => {
    const original = message("room-a", "message-a");
    const deleted = { ...original, deleted: true, content: null, version: 2 };
    let state = applyMessage({}, deleted);
    state = applyMessage(state, original);
    state = applySnapshot(state, {
      ...snapshot("room-a", "user-mei"),
      messages: [original],
    });
    expect(state["room-a"]?.messages).toEqual([deleted]);
  });

  it("replaces the cached window on refresh while preserving newer live deliveries", () => {
    const old = message("room-a", "old");
    const refreshed = { ...message("room-a", "recent"), sequence: 101 };
    const live = { ...message("room-a", "live"), sequence: 102 };
    let state = applyMessage(applyMessage({}, old), live);
    state = applySnapshot(state, {
      ...snapshot("room-a", "user-mei"),
      messages: [refreshed],
      nextSequence: 101,
      reset: true,
    });
    expect(state["room-a"]?.messages).toEqual([refreshed, live]);
  });
  it("keeps messages and members isolated between joined rooms", () => {
    let state = applySnapshot({}, snapshot("room-a", "user-mei"));
    state = applySnapshot(state, snapshot("room-b", "user-yuki"));
    state = applyMessage(state, message("room-a", "message-a"));
    state = applyMessage(state, message("room-b", "message-b"));

    const removed: MemberView = {
      userId: "user-yuki",
      name: "Yuki",
      role: "member",
      active: false,
      version: 2,
    };
    state = applyMembership(state, "room-b", removed);

    expect(state["room-a"]?.messages.map((item) => item.id)).toEqual([
      "message-a",
    ]);
    expect(state["room-b"]?.messages.map((item) => item.id)).toEqual([
      "message-b",
    ]);
    expect(state["room-a"]?.members[0]?.active).toBe(true);
    expect(state["room-b"]?.members[0]).toEqual(removed);
  });
});
