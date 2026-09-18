import { describe, expect, it } from "vitest";
import { limits } from "../src/server/config.ts";
import { DomainError } from "../src/server/database.ts";
import { createHarness } from "./harness.ts";

describe("CedarFile permissive domain", () => {
  it("keeps normal navigation bounded to owner and share facts", () => {
    const harness = createHarness();
    try {
      const priya = harness.user("user-priya");
      const lee = harness.user("user-lee");
      expect(
        harness.service.list(priya).resources.map((item) => item.id),
      ).toEqual(["res_01K3SHAREAAA"]);
      expect(
        harness.service.list(lee).resources.map((item) => item.id),
      ).toEqual(["res_01K3VIEWAAAA"]);
    } finally {
      harness.close();
    }
  });

  it("exposes the three direct-resource authorization gaps", () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      const priya = harness.user("user-priya");
      const lee = harness.user("user-lee");
      const notes = harness.service.details(priya, "res_01K3NOTESAAA").resource;
      expect(notes.access).toBe("editor");
      expect(() =>
        harness.service.share(
          priya,
          notes.id,
          notes.version,
          "user-lee",
          "editor",
        ),
      ).not.toThrow();
      expect(
        harness.service.read(lee, "res_01K3PRIVATEA").resource.access,
      ).toBe("none");
      expect(
        harness.service.read(jordan, "res_01K3PRIVATEB").resource.access,
      ).toBe("none");
    } finally {
      harness.close();
    }
  });

  it("enforces collisions and optimistic versions", async () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      expect(() =>
        harness.service.createFolder(
          jordan,
          "res_01K3ROOTAAAA",
          "PRIVATE-PLAN.TXT",
        ),
      ).toThrowError(DomainError);
      harness.service.createFolder(jordan, "res_01K3ROOTAAAA", "Café");
      expect(() =>
        harness.service.createFolder(jordan, "res_01K3ROOTAAAA", "CAFE\u0301"),
      ).toThrowError(DomainError);

      const resource = harness.service.details(
        jordan,
        "res_01K3PRIVATEA",
      ).resource;
      await expect(
        harness.service.replace(
          jordan,
          resource.id,
          resource.version + 1,
          Buffer.from("changed"),
        ),
      ).rejects.toMatchObject({ code: "stale_resource_version" });
      expect(harness.storage.read(resource.id).toString()).toMatch(/private/i);
    } finally {
      harness.close();
    }
  });

  it("enforces workspace byte and resource bounds", () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      expect(() =>
        harness.database.assertCapacity(
          "workspace-a",
          limits.workspaceBytes + 1,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "workspace_quota_exceeded" }),
      );
      for (let index = 0; index < 95; index += 1) {
        harness.service.createFolder(
          jordan,
          "res_01K3ROOTAAAA",
          `Capacity ${index}`,
        );
      }
      expect(() =>
        harness.service.createFolder(
          jordan,
          "res_01K3ROOTAAAA",
          "Capacity overflow",
        ),
      ).toThrowError(
        expect.objectContaining({ code: "workspace_resource_limit" }),
      );
    } finally {
      harness.close();
    }
  });
  it("moves metadata while keeping the opaque physical object stable", () => {
    const harness = createHarness();
    try {
      const jordan = harness.user("user-jordan");
      const file = harness.service.details(jordan, "res_01K3PRIVATEA").resource;
      const before = harness.storage.objectPath(file.id);
      const moved = harness.service.move(
        jordan,
        file.id,
        file.version,
        "res_01K3SHAREAAA",
      );
      expect(moved.parentId).toBe("res_01K3SHAREAAA");
      expect(harness.storage.objectPath(file.id)).toBe(before);
    } finally {
      harness.close();
    }
  });
});
