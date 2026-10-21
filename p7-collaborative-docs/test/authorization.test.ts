import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeAuthorization } from "../src/server/authorization.ts";

afterEach(() => vi.restoreAllMocks());

describe("baseline authorization", () => {
  it("logs each allowed capability without request facts", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const authorization = fakeAuthorization();
    const decisions = await authorization.authorizeMany([
      {
        requestId: "req-123",
        capability: "document.edit",
        principalId: "user-noah",
        resourceId: "doc-launch-brief",
        facts: { content: "private document text", token: "secret-token" },
      },
    ]);
    expect(decisions).toEqual({ "document.edit": true });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "P7 server | FAKE ALLOW | document.edit | user-noah -> doc-launch-brief | req-123",
    );
  });
});
