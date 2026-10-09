import { describe, expect, it, vi } from "vitest";
import { runMcpRequest } from "../scripts/mcp-request.js";
import { loadConfig } from "../src/config/project-config.js";

function fixture() {
  const callToolDirect = vi.fn().mockResolvedValue({
    content: [],
    structuredContent: { incidents: [] },
  });
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    callToolDirect,
    close,
    dependencies: {
      loadEnvironment: vi.fn(),
      config: () => loadConfig({}),
      authorize: vi.fn().mockResolvedValue("private-access-token"),
      connect: vi.fn().mockResolvedValue({ callToolDirect, close }),
      confirm: vi.fn().mockResolvedValue(true),
      key: vi.fn().mockReturnValue("fresh-request-1234"),
      output: vi.fn(),
      error: vi.fn(),
    },
  };
}

const update = ["amir", "update", "INC-2001", "mitigated", "resolved"];

describe("provider-free MCP requests", () => {
  it("authenticates and searches through the real client interface without a provider key", async () => {
    const { dependencies, callToolDirect, close } = fixture();
    expect(
      await runMcpRequest(["amir", "search", "INC-2001"], dependencies),
    ).toBe(0);
    expect(dependencies.authorize).toHaveBeenCalledWith("amir", loadConfig({}));
    expect(dependencies.connect).toHaveBeenCalledWith({
      endpoint: "http://localhost:17003/mcp",
      accessToken: "private-access-token",
    });
    expect(callToolDirect).toHaveBeenCalledWith("search_incidents", {
      query: "INC-2001",
      limit: 5,
    });
    expect(dependencies.confirm).not.toHaveBeenCalled();
    expect(dependencies.output).toHaveBeenCalledWith(
      JSON.stringify({ incidents: [] }, null, 2),
    );
    expect(JSON.stringify(dependencies.output.mock.calls)).not.toContain(
      "private-access-token",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("confirms an explicit update and supplies a fresh idempotency key", async () => {
    const { dependencies, callToolDirect, close } = fixture();
    dependencies.key
      .mockReturnValueOnce("first-request-1234")
      .mockReturnValueOnce("second-request-5678");
    expect(await runMcpRequest(update, dependencies)).toBe(0);
    expect(await runMcpRequest(update, dependencies)).toBe(0);
    expect(dependencies.confirm).toHaveBeenCalledWith(
      "Advance INC-2001 from mitigated to resolved?",
    );
    for (const [index, key] of [
      "first-request-1234",
      "second-request-5678",
    ].entries()) {
      expect(callToolDirect).toHaveBeenNthCalledWith(
        index + 1,
        "update_incident_status",
        {
          incidentId: "INC-2001",
          expectedStatus: "mitigated",
          nextStatus: "resolved",
          confirmed: true,
          idempotencyKey: key,
        },
      );
    }
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("cancels without invoking the tool", async () => {
    const { dependencies, callToolDirect, close } = fixture();
    dependencies.confirm.mockResolvedValue(false);
    expect(await runMcpRequest(update, dependencies)).toBe(0);
    expect(callToolDirect).not.toHaveBeenCalled();
    expect(dependencies.output).toHaveBeenCalledWith(
      "Status change cancelled.",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    [],
    ["unknown", "search", "INC-2001"],
    ["amir", "search"],
    ["amir", "search", " "],
    ["amir", "search", "x".repeat(121)],
    ["amir", "search", "INC-2001", "extra"],
    ["amir", "delete", "INC-2001"],
    ["amir", "update", "not-an-id", "mitigated", "resolved"],
    ["amir", "update", "INC-2001", "unknown", "resolved"],
    [...update, "extra"],
  ])("rejects invalid arguments before sign-in: %j", async (...args) => {
    const { dependencies } = fixture();
    expect(await runMcpRequest(args, dependencies)).toBe(2);
    expect(dependencies.loadEnvironment).not.toHaveBeenCalled();
    expect(dependencies.authorize).not.toHaveBeenCalled();
    expect(dependencies.connect).not.toHaveBeenCalled();
  });

  it.each([
    "authorization_denied",
    "stale_incident_state",
    "authorization_unavailable",
  ])("reports %s as a failed request", async (code) => {
    const { dependencies, callToolDirect, close } = fixture();
    callToolDirect.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: code }],
    });
    expect(await runMcpRequest(update, dependencies)).toBe(1);
    expect(dependencies.error).toHaveBeenCalledWith(code);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not print an unrecognized remote error body", async () => {
    const { dependencies, callToolDirect } = fixture();
    callToolDirect.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "private-access-token" }],
    });
    expect(await runMcpRequest(update, dependencies)).toBe(1);
    expect(dependencies.error).toHaveBeenCalledWith("operation_unavailable");
    expect(JSON.stringify(dependencies.error.mock.calls)).not.toContain(
      "private-access-token",
    );
  });

  it.each(["authorize", "connect", "invoke", "confirm"])(
    "sanitizes a %s failure and closes any established connection",
    async (stage) => {
      const { dependencies, callToolDirect, close } = fixture();
      const failure = new Error("private-access-token");
      if (stage === "authorize")
        dependencies.authorize.mockRejectedValue(failure);
      else if (stage === "connect")
        dependencies.connect.mockRejectedValue(failure);
      else if (stage === "confirm")
        dependencies.confirm.mockRejectedValue(failure);
      else callToolDirect.mockRejectedValue(failure);
      expect(await runMcpRequest(update, dependencies)).toBe(1);
      expect(JSON.stringify(dependencies.error.mock.calls)).not.toContain(
        "private-access-token",
      );
      expect(close).toHaveBeenCalledTimes(
        stage === "invoke" || stage === "confirm" ? 1 : 0,
      );
      if (stage === "authorize")
        expect(dependencies.connect).not.toHaveBeenCalled();
    },
  );

  it("reports a cleanup failure without exposing its details", async () => {
    const { dependencies, close } = fixture();
    close.mockRejectedValue(new Error("private-access-token"));
    expect(
      await runMcpRequest(["dana", "search", "INC-2001"], dependencies),
    ).toBe(1);
    expect(dependencies.error).toHaveBeenCalledWith(
      "Could not close the MCP connection.",
    );
  });
});
