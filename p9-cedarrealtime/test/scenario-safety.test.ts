import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertScenarioIdle } from "../scripts/scenario-safety.ts";

describe("Docker scenario containment", () => {
  it("refuses to replace an active learner stack", () => {
    expect(() => assertScenarioIdle("cedarrealtime\n")).toThrow();
    expect(() => assertScenarioIdle("\n")).not.toThrow();
  });

  it("excludes project secrets and local state from Docker builds", () => {
    const entries = new Set(
      readFileSync(".dockerignore", "utf8").split(/\r?\n/u).filter(Boolean),
    );
    for (const entry of [".env", ".local", "dist", "node_modules"]) {
      expect(entries).toContain(entry);
    }
    expect(readFileSync(".gitignore", "utf8")).toContain("!.dockerignore");
  });
});
