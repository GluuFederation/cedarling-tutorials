import { describe, expect, it } from "vitest";
import {
  assertScenarioIdle,
  parseRunningServices,
} from "../scripts/scenario-safety.ts";

describe("P8 Docker scenario safety", () => {
  it("parses only running Compose service names", () => {
    expect(parseRunningServices("\n")).toEqual([]);
    expect(parseRunningServices("identity-provider\ncedarfile\n")).toEqual([
      "identity-provider",
      "cedarfile",
    ]);
  });

  it("rejects a running learner stack with a direct instruction", () => {
    expect(() => assertScenarioIdle("")).not.toThrow();
    expect(() => assertScenarioIdle("cedarfile\n")).toThrow(
      "Stop the P8 Compose services before running the permissive scenario: cedarfile",
    );
  });
});
