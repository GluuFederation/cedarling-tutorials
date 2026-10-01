import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../src/mcp/authorization.js";
import { IncidentChatHost } from "../src/chat/host.js";
import { OpenRouterChatModel } from "../src/chat/openrouter.js";
import type { ChatMessage, ChatModel, ModelTool } from "../src/chat/model.js";
import { ScriptedChatModel } from "./support/scripted-model.js";
import { McpClientSession } from "../src/mcp/client.js";
import { startTestApplication, type TestApplication } from "./helpers.js";

const applications: TestApplication[] = [];
const sessions: McpClientSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((client) => client.close()));
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

async function session(
  application: TestApplication,
  persona: "dana" | "amir" | "eve",
) {
  const client = await McpClientSession.connect({
    endpoint: application.endpoint,
    accessToken: await application.token(persona),
  });
  sessions.push(client);
  return client;
}

describe("P3 incident workflows", () => {
  it("makes no MCP call for an empty response, then recovers without replaying the failed turn", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: null } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "search_incidents",
                      arguments: '{"query":"INC-1001"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    const host = new IncidentChatHost({
      mcp: await session(application, "dana"),
      model: new OpenRouterChatModel({
        apiKey: "test-key",
        model: "liquid/lfm-2.5-2.6b:free",
        timeoutMs: 1000,
        fetch: request,
      }),
      confirm: async () => true,
    });
    await host.connect();
    const calls = application.calls.length;
    await expect(host.send("Resolve all incidents")).rejects.toMatchObject({
      code: "invalid_model_response",
    });
    expect(application.calls).toHaveLength(calls);
    expect(application.incidents.get("INC-1001").version).toBe(1);
    expect(await host.send("Find INC-1001")).toContain("INC-1001");
    const second = JSON.parse(request.mock.calls[1]![1]!.body as string) as {
      messages: ChatMessage[];
    };
    expect(
      second.messages.filter(
        (message: { role: string }) => message.role === "user",
      ),
    ).toEqual([{ role: "user", content: "Find INC-1001" }]);
  });

  it("handles a greeting after an incident request without invoking MCP or confirmation", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const model: ChatModel = new ScriptedChatModel([
      { name: "search_incidents", arguments: { query: "INC-1001" } },
      null,
      { name: "triage_incident", arguments: { incidentId: "INC-1001" } },
    ]);
    const next = vi.spyOn(model, "next");
    const confirm = vi.fn(async () => true);
    const activity = vi.fn();
    const host = new IncidentChatHost({
      mcp: await session(application, "amir"),
      model,
      confirm,
      activity,
    });
    await host.connect();
    expect(await host.send("Find INC-1001")).toContain("INC-1001");
    const calls = application.calls.length;
    const activities = activity.mock.calls.length;
    const reply = await host.send("Hi, how are you?");
    expect(reply).toBe(
      "No incident operation was requested. I can help you search incidents, read the runbook, prepare triage, or advance one incident. What would you like to do?",
    );
    expect(application.calls).toHaveLength(calls);
    expect(activity).toHaveBeenCalledTimes(activities);
    expect(confirm).not.toHaveBeenCalled();
    expect(application.incidents.get("INC-1001").version).toBe(1);
    expect(await host.send("Prepare triage for that incident")).toContain(
      "Triage INC-1001",
    );
    expect(next.mock.calls[2]?.[0]).toEqual(
      expect.arrayContaining([
        { role: "user", content: "Hi, how are you?" },
        { role: "assistant", content: reply },
      ]),
    );
  });

  it("rejects an unavailable model capability before invoking MCP", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const host = new IncidentChatHost({
      mcp: await session(application, "dana"),
      model: new ScriptedChatModel([
        { name: "delete_all_incidents", arguments: {} },
      ]),
      confirm: async () => true,
    });
    await host.connect();
    const calls = application.calls.length;
    await expect(host.send("Delete incidents")).rejects.toMatchObject({
      code: "unavailable_capability",
    });
    expect(application.calls).toHaveLength(calls);
  });

  it("records cancellation in the next model turn without changing an incident", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const next = vi
      .fn()
      .mockResolvedValueOnce({
        name: "update_incident_status",
        arguments: {
          incidentId: "INC-1001",
          expectedStatus: "open",
          nextStatus: "investigating",
        },
      })
      .mockResolvedValueOnce({
        name: "search_incidents",
        arguments: { query: "INC-1001" },
      });
    const host = new IncidentChatHost({
      mcp: await session(application, "amir"),
      model: { next },
      confirm: async () => false,
    });
    await host.connect();
    expect(await host.send("Investigate INC-1001")).toBe(
      "Status change cancelled.",
    );
    await host.send("Find INC-1001");
    expect(next.mock.calls[1]![0]).toEqual([
      { role: "user", content: "Investigate INC-1001" },
      { role: "assistant", content: "Status change cancelled." },
      { role: "user", content: "Find INC-1001" },
    ]);
    expect(application.incidents.get("INC-1001").version).toBe(1);
  });
  it("runs all four operations through the chat host and MCP", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const host = new IncidentChatHost({
      mcp: await session(application, "amir"),
      model: new ScriptedChatModel([
        {
          name: "search_incidents",
          arguments: { query: "payment", limit: 5 },
        },
        {
          name: "incident_response_runbook",
          arguments: {},
        },
        {
          name: "triage_incident",
          arguments: { incidentId: "INC-1001" },
        },
        {
          name: "update_incident_status",
          arguments: {
            incidentId: "INC-1001",
            expectedStatus: "open",
            nextStatus: "investigating",
          },
        },
      ]),
      confirm: async () => true,
    });
    await host.connect();
    expect(await host.send("Find the payment incident.")).toContain("INC-1001");
    expect(await host.send("Read the runbook.")).toContain("Incident response");
    expect(await host.send("Build a triage prompt.")).toContain(
      "Triage INC-1001",
    );
    expect(await host.send("Advance the incident.")).toContain(
      '"status":"investigating"',
    );
    expect(application.incidents.get("INC-1001").version).toBe(2);
    expect(
      application.calls
        .filter(({ action }) => action !== "Discover")
        .map(({ action }) => action),
    ).toEqual(["Search", "Read", "ReadRunbook", "Triage", "UpdateStatus"]);
  });

  it("hides discovery and does not invoke the model for a denied caller", async () => {
    const application = await startTestApplication(async () => false);
    applications.push(application);
    const mcp = await session(application, "eve");
    expect(await mcp.discover()).toEqual([]);
    const next = vi.fn();
    const host = new IncidentChatHost({
      mcp,
      model: { next },
      confirm: async () => true,
    });
    await host.connect();
    expect(await host.send("Find incidents")).toBe(
      "No incident operations are available for this account.",
    );
    expect(next).not.toHaveBeenCalled();
    await expect(
      mcp.callToolDirect("update_incident_status", {
        incidentId: "INC-1001",
        expectedStatus: "open",
        nextStatus: "investigating",
        confirmed: true,
        idempotencyKey: "hidden-direct",
      }),
    ).rejects.toMatchObject({
      name: "ProtocolError",
      code: -32602,
      message: "Tool update_incident_status not found",
    });
    expect(application.incidents.get("INC-1001").version).toBe(1);
  });

  it("filters incident decisions before applying the requested limit", async () => {
    const application = await startTestApplication(
      async (_auth, action, resource) =>
        action !== "Read" || resource.id !== "INC-1001",
    );
    applications.push(application);
    const mcp = await session(application, "amir");
    const result = await mcp.callToolDirect("search_incidents", {
      query: "INC-",
      limit: 1,
    });
    expect(result.structuredContent).toMatchObject({
      incidents: [{ id: "INC-1002" }],
    });
    expect(JSON.stringify(result)).not.toContain("INC-1001");
    expect(
      application.calls
        .filter(({ action }) => action === "Read")
        .map(({ resource }) => resource.id),
    ).toEqual(["INC-1001", "INC-1002"]);
  });

  it("blocks direct mutations and prompt content when resource authorization denies", async () => {
    const application = await startTestApplication(
      async (_auth, action) => action !== "UpdateStatus" && action !== "Triage",
    );
    applications.push(application);
    const mcp = await session(application, "amir");
    await mcp.discover();
    const result = await mcp.callToolDirect("update_incident_status", {
      incidentId: "INC-2001",
      expectedStatus: "mitigated",
      nextStatus: "resolved",
      confirmed: true,
      idempotencyKey: "denied-update",
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ text: "authorization_denied" }],
    });
    await expect(
      mcp.invoke("triage_incident", { incidentId: "INC-2001" }),
    ).rejects.toThrow("authorization_denied");
    expect(application.incidents.get("INC-2001").version).toBe(1);
  });

  it("preserves state when the sidecar fails at the update boundary", async () => {
    const application = await startTestApplication(async (_auth, action) => {
      if (action === "UpdateStatus")
        throw new AuthorizationError("authorization_unavailable");
      return true;
    });
    applications.push(application);
    const mcp = await session(application, "dana");
    expect(
      await mcp.callToolDirect("update_incident_status", {
        incidentId: "INC-1001",
        expectedStatus: "open",
        nextStatus: "investigating",
        confirmed: true,
        idempotencyKey: "failed-update",
      }),
    ).toMatchObject({
      isError: true,
      content: [{ text: "authorization_unavailable" }],
    });
    expect(application.incidents.get("INC-1001").version).toBe(1);
  });

  it("keeps the conversation usable after a denied triage request", async () => {
    const application = await startTestApplication(
      async (_auth, action) => action !== "Triage",
    );
    applications.push(application);
    const host = new IncidentChatHost({
      mcp: await session(application, "amir"),
      confirm: async () => true,
      model: new ScriptedChatModel([
        { name: "triage_incident", arguments: { incidentId: "INC-2001" } },
        { name: "search_incidents", arguments: { query: "INC-1001" } },
      ]),
    });
    await host.connect();
    expect(await host.send("Triage the audit incident")).toBe(
      "authorization_denied",
    );
    expect(await host.send("Find my payment incident")).toContain("INC-1001");
    expect(application.incidents.get("INC-2001").version).toBe(1);
  });

  it("cancels without an MCP effect even when the model claims confirmation", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const host = new IncidentChatHost({
      mcp: await session(application, "amir"),
      model: new ScriptedChatModel([
        {
          name: "update_incident_status",
          arguments: {
            incidentId: "INC-1001",
            expectedStatus: "open",
            nextStatus: "investigating",
            confirmed: true,
          },
        },
      ]),
      confirm: async () => false,
    });
    await host.connect();
    expect(await host.send("Advance INC-1001.")).toBe(
      "Status change cancelled.",
    );
    expect(
      application.calls.some(({ action }) => action === "UpdateStatus"),
    ).toBe(false);
    expect(application.incidents.get("INC-1001")).toMatchObject({
      status: "open",
      version: 1,
    });
  });

  it("supplies discovered descriptors and owns update safety arguments", async () => {
    const application = await startTestApplication();
    applications.push(application);
    let tools: readonly ModelTool[] = [];
    const host = new IncidentChatHost({
      mcp: await session(application, "dana"),
      model: {
        async next(_messages, descriptors) {
          tools = descriptors;
          const status = application.incidents.get("INC-1001").status;
          return {
            name: "update_incident_status",
            arguments: {
              incidentId: "INC-1001",
              expectedStatus: status,
              nextStatus: status === "open" ? "investigating" : "mitigated",
              confirmed: false,
              idempotencyKey: "model-reused-key",
            },
          };
        },
      },
      confirm: async () => true,
    });
    await host.connect();
    await host.send("Investigate the incident.");
    await host.send("Mitigate the incident.");
    expect(application.incidents.get("INC-1001")).toMatchObject({
      status: "mitigated",
      version: 3,
    });
    expect(tools.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "tool", name: "search_incidents" },
      { kind: "tool", name: "update_incident_status" },
      { kind: "resource", name: "incident_response_runbook" },
      { kind: "prompt", name: "triage_incident" },
    ]);
    const schema = tools.find(
      ({ name }) => name === "update_incident_status",
    )!.inputSchema;
    expect(Object.keys(schema.properties as object)).toEqual([
      "incidentId",
      "expectedStatus",
      "nextStatus",
    ]);
    expect(schema.required).toEqual([
      "incidentId",
      "expectedStatus",
      "nextStatus",
    ]);
    expect(tools.find(({ kind }) => kind === "resource")!.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });

  it("validates confirmed direct calls, idempotent retries, and stale mutations", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const token = await application.token("dana");
    const mcp = await McpClientSession.connect({
      endpoint: application.endpoint,
      accessToken: token,
    });
    sessions.push(mcp);
    const input = {
      incidentId: "INC-1001",
      expectedStatus: "open",
      nextStatus: "investigating",
      idempotencyKey: "direct-update",
    };
    const invalid = await mcp.callToolDirect("update_incident_status", input);
    expect(invalid.isError).toBe(true);
    expect(
      application.calls.some(({ action }) => action === "UpdateStatus"),
    ).toBe(false);
    expect(application.incidents.get("INC-1001").version).toBe(1);

    const valid = { ...input, confirmed: true };
    const result = await mcp.callToolDirect("update_incident_status", valid);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      incident: { id: "INC-1001", status: "investigating", version: 2 },
    });
    await mcp.callToolDirect("update_incident_status", valid);
    expect(application.incidents.get("INC-1001").version).toBe(2);
    const stale = await mcp.callToolDirect("update_incident_status", {
      ...valid,
      idempotencyKey: "another-update",
    });
    expect(stale.isError).toBe(true);
    expect(stale.content).toContainEqual({
      type: "text",
      text: "stale_incident_state",
    });
    expect(application.incidents.get("INC-1001").version).toBe(2);
    expect(JSON.stringify(application.calls)).not.toContain(token);
  });
});
