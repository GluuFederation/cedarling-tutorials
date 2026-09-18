import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { databasePath } from "../src/server/database.ts";
import { SafeStorage } from "../src/server/storage.ts";
import { temporaryRoot } from "./temporary-root.ts";

describe("storage root containment", () => {
  it("rejects a configured root that resolves through a symbolic link", () => {
    const base = temporaryRoot("p8-boundary-");
    try {
      const owned = path.join(base, "owned");
      const linked = path.join(base, "linked");
      mkdirSync(owned);
      symlinkSync(owned, linked, "dir");
      expect(() => new SafeStorage(linked)).toThrow(
        "storage_boundary_rejected",
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a SQLite filename linked outside the owned root", () => {
    const base = temporaryRoot("p8-boundary-");
    try {
      const owned = path.join(base, "owned");
      const outside = path.join(base, "outside.sqlite");
      mkdirSync(owned);
      writeFileSync(outside, "not a database");
      symlinkSync(outside, path.join(owned, "p8.sqlite"));
      expect(() => databasePath(owned)).toThrow("database_path_rejected");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses to stage a linked opaque object", () => {
    const base = temporaryRoot("p8-boundary-");
    try {
      const storage = new SafeStorage(path.join(base, "owned"));
      const id = "res_TESTLINKSTAGE";
      const outside = path.join(base, "outside.txt");
      writeFileSync(outside, "outside");
      symlinkSync(outside, storage.objectPath(id), "file");
      expect(() => storage.stage([id])).toThrow("storage_boundary_rejected");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
  it("rejects malformed persisted operation and resource identifiers", () => {
    const base = temporaryRoot("p8-boundary-");
    try {
      const storage = new SafeStorage(path.join(base, "owned"));
      const id = "res_TESTPERSISTED1";
      storage.writeNew(id, Buffer.from("safe"));
      expect(() =>
        storage.cleanup({ operationId: "../objects", resourceIds: [id] }),
      ).toThrow("storage_boundary_rejected");
      expect(() =>
        storage.cleanup({
          operationId: "op_TESTOPERATION01",
          resourceIds: ["../outside"],
        }),
      ).toThrow("storage_boundary_rejected");
      expect(storage.read(id).toString()).toBe("safe");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects a quarantine directory replaced by a symbolic link", () => {
    const base = temporaryRoot("p8-boundary-");
    try {
      const storage = new SafeStorage(path.join(base, "owned"));
      const operationId = "op_TESTLINKSWAP01";
      const resourceId = "res_TESTLINKSWAP01";
      const outside = path.join(base, "outside");
      mkdirSync(outside);
      writeFileSync(path.join(outside, resourceId), "outside");
      symlinkSync(outside, path.join(storage.quarantine, operationId), "dir");

      expect(() =>
        storage.cleanup({ operationId, resourceIds: [resourceId] }),
      ).toThrow("storage_boundary_rejected");
      expect(existsSync(path.join(outside, resourceId))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
