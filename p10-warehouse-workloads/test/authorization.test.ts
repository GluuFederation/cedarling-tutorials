import { describe, expect, it } from "vitest";
import { fakeAuthorization } from "../src/server/authorization.ts";
import { CAPABILITIES } from "../src/shared/capabilities.ts";

describe("authorization boundary", () => {
  it("keeps the five business capabilities and labels the fake decision", async () => {
    expect(
      new Set(Object.values(CAPABILITIES).map(({ capability }) => capability)),
    ).toEqual(
      new Set([
        "inventory.read",
        "transfer.read",
        "transfer.create",
        "transfer.release",
        "transfer.receive",
      ]),
    );
    const lines: string[] = [];
    const allowed = await fakeAuthorization((line) =>
      lines.push(line),
    ).authorize({
      requestId: "request-1",
      workloadId: "inventory-auditor",
      capability: "transfer.create",
      action: "Transfer::Create",
      accessToken: "signed-secret-token",
      resourceId: "north:south",
      facts: { quantity: 8 },
    });
    expect(allowed).toBe(true);
    expect(lines).toEqual([
      "P10 server | FAKE ALLOW | transfer.create | inventory-auditor -> north:south | request-1",
    ]);
    expect(lines.join("\n")).not.toContain("signed-secret-token");
  });
});
