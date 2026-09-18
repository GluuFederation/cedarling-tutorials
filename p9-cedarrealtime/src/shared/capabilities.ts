export const capabilityCatalog = {
  "chat.connect": "Chat::Connect",
  "room.enter": "Chat::EnterRoom",
  "message.publish": "Chat::PublishMessage",
  "message.deliver": "Chat::DeliverMessage",
  "member.remove": "Chat::RemoveMember",
  "membership.deliver": "Chat::DeliverMembershipEvent",
  "message.delete": "Chat::DeleteMessage",
  "message.deletion.deliver": "Chat::DeliverMessageDeletion",
} as const;

export type Capability = keyof typeof capabilityCatalog;
