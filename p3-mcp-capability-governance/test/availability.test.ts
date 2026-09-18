import { describe, expect, it, vi } from "vitest";
import { requireMcpServer } from "../src/mcp/availability.js";

describe("P3 MCP startup preflight", () => {
  it("fails before Device Flow with an actionable message when the server is absent", async () => {
    await expect(
      requireMcpServer(
        "http://p3.localhost:3003/mcp",
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      ),
    ).rejects.toThrow(
      "P3 MCP server is unavailable at http://p3.localhost:3003. Start it with pnpm dev",
    );
  });

  it("accepts only the expected JSON health response", async () => {
    await expect(
      requireMcpServer(
        "http://p3.localhost:3003/mcp",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "ok",
              service: "p3-mcp-capability-governance",
            }),
            { headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireMcpServer(
        "http://p3.localhost:3003/mcp",
        vi.fn().mockResolvedValue(new Response("ok")),
      ),
    ).rejects.toThrow("does not expose the expected P3 health endpoint");
  });
});
