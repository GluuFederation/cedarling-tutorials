import { describe, expect, it } from "vitest";
import { capabilityCatalog } from "../src/shared/capabilities.ts";
import { clientEvents, realtimeEvents } from "../src/shared/protocol.ts";

describe("shared authorization and realtime catalogs", () => {
  it("keeps every protected capability bound to its Cedar action", () => {
    expect(capabilityCatalog).toEqual({
      "chat.connect": "Chat::Connect",
      "room.enter": "Chat::EnterRoom",
      "message.publish": "Chat::PublishMessage",
      "message.deliver": "Chat::DeliverMessage",
      "member.remove": "Chat::RemoveMember",
      "membership.deliver": "Chat::DeliverMembershipEvent",
      "message.delete": "Chat::DeleteMessage",
      "message.deletion.deliver": "Chat::DeliverMessageDeletion",
    });
  });

  it("keeps the public realtime protocol exact", () => {
    expect(realtimeEvents).toEqual({
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
    });
    expect(clientEvents).toEqual([
      "room:enter",
      "message:publish",
      "member:remove",
      "message:delete",
    ]);
  });
});
