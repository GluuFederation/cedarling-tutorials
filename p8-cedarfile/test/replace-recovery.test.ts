import { rmSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AppDatabase, databasePath } from "../src/server/database.ts";
import { FileService } from "../src/server/service.ts";
import { SafeStorage } from "../src/server/storage.ts";
import { temporaryRoot } from "./temporary-root.ts";

describe("replace recovery", () => {
  it("keeps committed new bytes and retries old-byte cleanup after restart", async () => {
    const root = temporaryRoot("p8-replace-");
    const issuer = "http://idp.localhost:4000";
    const storage = new SafeStorage(root);
    let runtime = new AppDatabase(databasePath(root), issuer, storage);
    try {
      const service = new FileService(runtime.resources, storage);
      const jordan = runtime.sessions.findUserById("user-jordan");
      if (!jordan) throw new Error("Missing fixture user");
      const file = await service.createFile(
        jordan,
        "res_01K3ROOTAAAA",
        "restart.txt",
        Buffer.from("old bytes"),
      );
      vi.spyOn(storage, "cleanup").mockImplementationOnce(() => {
        throw new Error("storage_unavailable");
      });

      const updated = await service.replace(
        jordan,
        file.id,
        file.version,
        Buffer.from("new authoritative bytes"),
      );
      expect(updated.version).toBe(file.version + 1);
      expect(storage.read(file.id).toString()).toBe("new authoritative bytes");
      expect(runtime.resources.pendingDeletes()).toHaveLength(1);

      vi.restoreAllMocks();
      runtime.close();
      runtime = new AppDatabase(databasePath(root), issuer, storage);
      new FileService(runtime.resources, storage).retryCleanup();
      expect(runtime.resources.pendingDeletes()).toEqual([]);
      expect(storage.read(file.id).toString()).toBe("new authoritative bytes");
    } finally {
      runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
