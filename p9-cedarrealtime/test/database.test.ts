import { describe, expect, it } from "vitest";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import { createHarness } from "./harness.ts";

describe("SQLite chat repository", () => {
  it("seeds the exact three-room topology", () => {
    const harness = createHarness();
    try {
      expect(
        harness.database.chat.roomsForUser("user-mei").map((room) => room.id),
      ).toEqual(["room-a-general"]);
      expect(
        harness.database.chat.roomsForUser("user-kwame").map((room) => room.id),
      ).toEqual(["room-a-general", "room-a-restricted"]);
      expect(harness.database.chat.room("room-b-general")?.tenantId).toBe(
        "tenant-b",
      );
    } finally {
      harness.close();
    }
  });

  it("records a publication and its command result atomically", () => {
    const harness = createHarness();
    try {
      const input = {
        userId: "user-mei",
        roomId: "room-a-general",
        commandId: "command_publish_1",
        content: "one durable message",
        messageId: "message-one",
        now: 100,
      };
      const first = harness.database.chat.publish(input);
      const retry = harness.database.chat.publish({
        ...input,
        messageId: "message-two",
      });
      expect(first.duplicate).toBe(false);
      expect(retry).toEqual({ value: first.value, duplicate: true });
      expect(
        harness.database.chat.messagePageAfter("room-a-general", 0).messages,
      ).toHaveLength(1);
      expect(harness.database.chat.room("room-a-general")?.nextSequence).toBe(
        2,
      );
    } finally {
      harness.close();
    }
  });

  it("keeps authorization gaps separate from version and transition controls", () => {
    const harness = createHarness();
    try {
      const published = harness.database.chat.publish({
        userId: "user-kwame",
        roomId: "room-a-general",
        commandId: "command_publish_2",
        content: "delete me",
        messageId: "message-delete",
        now: 100,
      }).value;
      const removed = harness.database.chat.removeMember({
        actorId: "user-mei",
        roomId: "room-a-general",
        userId: "user-yuki",
        commandId: "command_remove_1",
        expectedVersion: 1,
        now: 200,
      });
      expect(removed.value).toMatchObject({ active: false, version: 2 });
      expect(() =>
        harness.database.chat.removeMember({
          actorId: "user-kwame",
          roomId: "room-a-general",
          userId: "user-yuki",
          commandId: "command_remove_2",
          expectedVersion: 1,
          now: 300,
        }),
      ).toThrow("membership_not_found");
      const deleted = harness.database.chat.deleteMessage({
        actorId: "user-mei",
        roomId: "room-a-general",
        messageId: published.id,
        commandId: "command_delete_1",
        expectedVersion: 1,
        now: 300,
      });
      expect(deleted.value).toMatchObject({
        deleted: true,
        version: 2,
        content: null,
      });
      expect(() =>
        harness.database.chat.deleteMessage({
          actorId: "user-mei",
          roomId: "room-a-general",
          messageId: published.id,
          commandId: "command_delete_2",
          expectedVersion: 1,
          now: 400,
        }),
      ).toThrow("message_already_deleted");
    } finally {
      harness.close();
    }
  });

  it("returns every message through bounded replay pages", () => {
    const harness = createHarness();
    try {
      for (let index = 0; index <= 100; index += 1) {
        harness.database.chat.publish({
          userId: "user-mei",
          roomId: "room-a-general",
          commandId: `page-command-${index}`,
          content: `message ${index}`,
          messageId: `page-message-${index}`,
          now: index,
        });
      }
      const first = harness.database.chat.messagePageAfter("room-a-general", 0);
      expect(first.messages).toHaveLength(100);
      expect(first.hasMore).toBe(true);
      const second = harness.database.chat.messagePageAfter(
        "room-a-general",
        first.messages.at(-1)?.sequence ?? 0,
      );
      expect(second.messages).toHaveLength(1);
      expect(second.hasMore).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("persists messages, memberships, sequences, and commands across reopen", () => {
    const harness = createHarness();
    const file = databasePath(harness.root);
    harness.database.chat.publish({
      userId: "user-mei",
      roomId: "room-a-general",
      commandId: "command_persist_1",
      content: "survives restart",
      messageId: "message-persisted",
      now: 100,
    });
    harness.database.close();
    const reopened = new AppDatabase(file, harness.config.issuer);
    try {
      expect(reopened.chat.message("message-persisted")?.content).toBe(
        "survives restart",
      );
      expect(
        reopened.chat.publish({
          userId: "user-mei",
          roomId: "room-a-general",
          commandId: "command_persist_1",
          content: "survives restart",
          messageId: "message-duplicate",
          now: 200,
        }).duplicate,
      ).toBe(true);
      expect(() =>
        reopened.chat.publish({
          userId: "user-mei",
          roomId: "room-a-general",
          commandId: "command_persist_1",
          content: "different request",
          messageId: "message-conflict",
          now: 300,
        }),
      ).toThrow("command_id_reused");
    } finally {
      reopened.close();
      harness.close();
    }
  });
});
