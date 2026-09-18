import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizationGateway } from "../src/server/authorization.ts";

afterEach(() => vi.restoreAllMocks());

const input = {
  principalId: "user-mei",
  capability: "message.publish" as const,
  resourceId: "room-a-general",
  facts: { byteSize: 5 },
  effect: "persist one message",
};

describe("authorization modes", () => {
  it("labels the permissive decision and never presents it as Cedarling", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const gateway = new AuthorizationGateway();
    const outcome = gateway.evaluate(input);
    expect(outcome.decision).toBe("FAKE ALLOW");
    expect(log.mock.calls.flat().join(" ")).toContain("P9 server | FAKE ALLOW");
    expect(log).toHaveBeenCalledTimes(1);
    expect(gateway.diagnostic("user-mei", outcome.requestId)).toEqual(outcome);
    expect(gateway.diagnostic("user-yuki", outcome.requestId)).toBeUndefined();
  });

  it("fails closed with an injected unavailable decision", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const outcome = new AuthorizationGateway(() => false).evaluate(input);
    expect(outcome).toMatchObject({
      decision: "UNAVAILABLE",
      effect: "none",
      reason: "authorization_unavailable",
    });
  });
});
