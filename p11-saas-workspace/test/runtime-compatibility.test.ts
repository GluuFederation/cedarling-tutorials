import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Node strip-only runtime compatibility", () => {
  it("executes the setup import graph under Node's strip-only loader", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        [
          "import('./src/server/errors.ts')",
          "import('./src/server/capabilities.ts')",
          "import('./src/server/service.ts')",
        ].join(";"),
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
