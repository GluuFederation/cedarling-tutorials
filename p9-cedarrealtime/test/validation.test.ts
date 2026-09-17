import { describe, expect, it } from "vitest";
import {
  deleteInput,
  enterInput,
  publishInput,
  removeInput,
} from "../src/server/validation.ts";

describe("realtime event validation", () => {
  it("accepts only the four exact bounded contracts", () => {
    expect(enterInput({ roomId: "room-a-general", lastSequence: 0 })).toEqual({
      roomId: "room-a-general",
      lastSequence: 0,
    });
    expect(
      publishInput({
        roomId: "room-a-general",
        commandId: "command_1234",
        content: "hello",
      }),
    ).toMatchObject({ content: "hello" });
    expect(
      removeInput({
        roomId: "room-a-general",
        userId: "user-yuki",
        commandId: "command_1235",
        expectedVersion: 1,
      }),
    ).toMatchObject({ userId: "user-yuki" });
    expect(
      deleteInput({
        roomId: "room-a-general",
        messageId: "message-1",
        commandId: "command_1236",
        expectedVersion: 1,
      }),
    ).toMatchObject({ messageId: "message-1" });
  });

  it.each([
    [{ roomId: "../general", lastSequence: 0 }],
    [{ roomId: "room-a-general", lastSequence: -1 }],
    [{ roomId: "room-a-general", lastSequence: 0, role: "moderator" }],
  ])("rejects malformed room entry %j", (value) => {
    expect(() => enterInput(value)).toThrow();
  });

  it("rejects empty, oversized, and extra-field messages", () => {
    const base = { roomId: "room-a-general", commandId: "command_1234" };
    expect(() => publishInput({ ...base, content: "" })).toThrow();
    expect(() =>
      publishInput({ ...base, content: "x".repeat(4_097) }),
    ).toThrow();
    expect(() =>
      publishInput({ ...base, content: "ok", tenantId: "tenant-b" }),
    ).toThrow();
  });
});
