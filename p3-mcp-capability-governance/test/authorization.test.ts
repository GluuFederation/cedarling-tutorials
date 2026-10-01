import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { authorize } from "../src/mcp/authorization.js";

const auth: AuthInfo = {
  token: "private-token",
  clientId: "p3-mcp-capability-governance-cli",
  scopes: ["mcp.access"],
  extra: { subject: "amir" },
};
const resource = {
  type: "Incident" as const,
  id: "INC-1001",
  assignedTo: "amir" as const,
};
afterEach(() => vi.restoreAllMocks());

describe("direct AuthZen request", () => {
  it("sends signed evidence and server facts, with a private bounded request", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ decision: true, context: {} }));
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      await authorize(auth, "UpdateStatus", resource, "request-1", request),
    ).toBe(true);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:5000/cedarling/evaluation");
    expect(options).toMatchObject({ method: "POST", redirect: "error" });
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    expect(typeof options!.body).toBe("string");
    expect(JSON.parse(options!.body as string)).toEqual({
      subject: {
        type: "JWT",
        id: "amir",
        properties: {
          tokens: [
            {
              mapping: "P3IncidentAssistant::Access_token",
              payload: auth.token,
            },
          ],
        },
      },
      action: { name: 'P3IncidentAssistant::Action::"UpdateStatus"' },
      resource: {
        type: "Incident",
        id: "INC-1001",
        properties: {
          cedar_entity_mapping: {
            entity_type: "P3IncidentAssistant::Incident",
            id: "INC-1001",
          },
          assigned_to: "amir",
        },
      },
      context: { caller: { subject: "amir", role: "analyst" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(auth.token);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual({
      event: "authorization.decision",
      requestId: "request-1",
      actorId: "amir",
      action: "UpdateStatus",
      resource: { type: "Incident", id: "INC-1001" },
      decision: "ALLOW",
    });
  });

  it("returns an actual denial and omits absent assignment rather than sending null", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ decision: false, context: {} }));
    expect(
      await authorize(
        auth,
        "Read",
        { ...resource, assignedTo: null },
        "request-2",
        request,
      ),
    ).toBe(false);
    expect(
      JSON.parse(request.mock.calls[0]![1]!.body as string).resource.properties,
    ).not.toHaveProperty("assigned_to");
  });

  it.each([
    ["HTTP failure", () => Response.json({ decision: true }, { status: 503 })],
    ["HTTP redirect", () => new Response(null, { status: 302 })],
    ["invalid JSON", () => new Response("not-json")],
    ["non-boolean", () => Response.json({ decision: "true", context: {} })],
    ["missing decision", () => Response.json({ context: {} })],
    [
      "sidecar exception",
      () =>
        Response.json({
          decision: false,
          context: {
            id: "-1",
            reason_admin: { Exception: "private diagnostics" },
          },
        }),
    ],
  ] as const)("fails closed on %s", async (_name, response) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      authorize(auth, "Read", resource, "request-failure", async () =>
        response(),
      ),
    ).rejects.toThrow("authorization_unavailable");
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      event: "authorization.failed",
      requestId: "request-failure",
      code: "authorization_unavailable",
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private-token|private diagnostics/,
    );
  });

  it("fails closed on connection failures", async () => {
    await expect(
      authorize(auth, "Read", resource, "unavailable", async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow("authorization_unavailable");
  });

  it("aborts an unresponsive sidecar within the configured deadline", async () => {
    const started = Date.now();
    const request: typeof fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    await expect(
      authorize(auth, "Read", resource, "timeout", request),
    ).rejects.toThrow("authorization_unavailable");
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
