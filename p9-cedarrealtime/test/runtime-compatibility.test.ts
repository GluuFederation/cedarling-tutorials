import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const runtimeFiles = ["src/server", "src/shared", "scripts"].flatMap((root) =>
  readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(root, entry)),
);

describe("Node type-stripping compatibility", () => {
  it.each(runtimeFiles)("%s uses erasable TypeScript syntax", (file) => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--check", file],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
