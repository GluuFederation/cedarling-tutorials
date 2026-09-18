import { describe, expect, it, vi } from "vitest";
import { authorizePersona } from "../src/auth/cli.js";
import { loadConfig } from "../src/config/project-config.js";

const config = loadConfig({}, process.cwd());

describe("P3 CLI identity", () => {
  it("returns the token only when its verified subject matches the requested persona", async () => {
    const output = vi.fn();
    const token = await authorizePersona("amir", config, {
      authorize: vi.fn().mockResolvedValue("signed-token"),
      verify: vi.fn().mockResolvedValue({
        subject: "amir",
        scopes: ["mcp.access"],
        expiresAt: 1_800,
      }),
      output,
    });

    expect(token).toBe("signed-token");
    expect(output).toHaveBeenCalledWith("Authenticated as amir.");
  });

  it("stops before MCP connection when another account approved the flow", async () => {
    await expect(
      authorizePersona("eve", config, {
        authorize: vi.fn().mockResolvedValue("signed-token"),
        verify: vi.fn().mockResolvedValue({
          subject: "dana",
          scopes: ["mcp.access"],
          expiresAt: 1_800,
        }),
        output: vi.fn(),
      }),
    ).rejects.toThrow("Authenticated as dana; rerun and sign in as eve");
  });
});
