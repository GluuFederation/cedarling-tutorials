import { existsSync, symlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHarness } from "./harness.ts";

describe("opaque storage", () => {
  it("writes, reads, stages, restores, and cleans one opaque object", () => {
    const harness = createHarness();
    try {
      const id = "res_TESTOBJECT001";
      harness.storage.writeNew(id, Buffer.from("safe"));
      expect(harness.storage.read(id).toString()).toBe("safe");
      const staged = harness.storage.stage([id]);
      expect(harness.storage.has(id)).toBe(false);
      harness.storage.restore(staged);
      expect(harness.storage.read(id).toString()).toBe("safe");
      const final = harness.storage.stage([id]);
      harness.storage.cleanup(final);
      expect(existsSync(harness.storage.objectPath(id))).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("rejects a final-target symbolic link", () => {
    const harness = createHarness();
    try {
      const id = "res_TESTOBJECT002";
      symlinkSync("/etc/passwd", harness.storage.objectPath(id));
      expect(() => harness.storage.read(id)).toThrow(
        "storage_boundary_rejected",
      );
    } finally {
      harness.close();
    }
  });
});
