import { describe, expect, it, vi } from "vitest";
import { limits } from "../src/server/config.ts";
import { createHarness } from "./harness.ts";

describe("bounded delete", () => {
  it("commits metadata deletion before cleaning quarantined content", async () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      const folder = harness.service.createFolder(
        jordan,
        "res_01K3ROOTAAAA",
        "Delete me",
      );
      const file = await harness.service.createFile(
        jordan,
        folder.id,
        "note.txt",
        Buffer.from("bounded content"),
      );

      expect(harness.service.delete(jordan, folder.id, folder.version)).toEqual(
        {
          deleted: true,
          count: 2,
        },
      );
      expect(harness.database.getResource(folder.id)).toBeUndefined();
      expect(harness.database.getResource(file.id)).toBeUndefined();
      expect(harness.storage.has(file.id)).toBe(false);
      expect(harness.database.pendingDeletes()).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("restores staged bytes when the metadata transaction fails", async () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      const file = await harness.service.createFile(
        jordan,
        "res_01K3ROOTAAAA",
        "rollback.txt",
        Buffer.from("restore me"),
      );
      vi.spyOn(harness.database, "deleteTree").mockImplementation(() => {
        throw new Error("database_unavailable");
      });

      expect(() =>
        harness.service.delete(jordan, file.id, file.version),
      ).toThrow("database_unavailable");
      expect(harness.database.getResource(file.id)).toBeDefined();
      expect(harness.storage.read(file.id).toString()).toBe("restore me");
    } finally {
      harness.close();
    }
  });

  it("retries post-commit quarantine cleanup without restoring metadata", async () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      const file = await harness.service.createFile(
        jordan,
        "res_01K3ROOTAAAA",
        "cleanup.txt",
        Buffer.from("remove me"),
      );
      const cleanup = vi
        .spyOn(harness.storage, "cleanup")
        .mockImplementationOnce(() => {
          throw new Error("storage_unavailable");
        });

      harness.service.delete(jordan, file.id, file.version);
      expect(harness.database.getResource(file.id)).toBeUndefined();
      expect(harness.database.pendingDeletes()).toHaveLength(1);
      cleanup.mockRestore();
      harness.service.retryCleanup();
      expect(harness.database.pendingDeletes()).toEqual([]);
    } finally {
      harness.close();
    }
  });
  it("rejects recursive deletion above the bound before any effect", () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      const folder = harness.service.createFolder(
        jordan,
        "res_01K3ROOTAAAA",
        "Bounded tree",
      );
      for (let index = 0; index <= limits.recursiveResources; index += 1) {
        harness.service.createFolder(jordan, folder.id, `Child ${index}`);
      }

      expect(() =>
        harness.service.delete(jordan, folder.id, folder.version),
      ).toThrowError(
        expect.objectContaining({ code: "recursive_limit_exceeded" }),
      );
      expect(harness.database.getResource(folder.id)).toBeDefined();
      expect(harness.database.descendants(folder.id)).toHaveLength(
        limits.recursiveResources + 2,
      );
    } finally {
      harness.close();
    }
  });
});
