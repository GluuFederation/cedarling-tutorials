import { afterEach, describe, expect, it } from "vitest";
import { IncidentChatHost } from "../src/chat/host.js";
import type { ModelTool } from "../src/chat/model.js";
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
  it("does not run an MCP operation for a greeting", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const host = new IncidentChatHost({
      mcp: await session(application, "amir"),
      model: new ScriptedChatModel([null]),
      confirm: async () => true,
    });
    await host.connect();
    expect(await host.send("Hi, how are you?")).toContain(
      "No incident operation was requested",
    );
    expect(application.traces).toHaveLength(0);
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
    expect(application.traces.map((trace) => trace.capabilityId)).toEqual([
      "incident.search",
      "runbook.read",
      "incident.triage",
      "incident.update",
    ]);
  });

  it.each(["dana", "amir", "eve"] as const)(
    "allows %s to find and update an unassigned incident",
    async (persona) => {
      const application = await startTestApplication();
      applications.push(application);
      const host = new IncidentChatHost({
        mcp: await session(application, persona),
        model: new ScriptedChatModel([
          {
            name: "search_incidents",
            arguments: { query: "audit" },
          },
          {
            name: "update_incident_status",
            arguments: {
              incidentId: "INC-2001",
              expectedStatus: "mitigated",
              nextStatus: "resolved",
            },
          },
        ]),
        confirm: async () => true,
      });
      await host.connect();
      expect(await host.send("Find the audit incident.")).toContain("INC-2001");
      expect(await host.send("Resolve it.")).toContain('"status":"resolved"');
      expect(application.incidents.get("INC-2001")).toMatchObject({
        assignedTo: null,
        status: "resolved",
        version: 2,
      });
      expect(application.traces).toEqual([
        expect.objectContaining({
          principal: persona,
          capabilityId: "incident.search",
        }),
        expect.objectContaining({
          principal: persona,
          capabilityId: "incident.update",
        }),
      ]);
    },
  );

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
    expect(application.traces).toHaveLength(0);
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

  it("validates direct tool calls while leaving authorization permissive", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const token = await application.token("eve");
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
    expect(application.traces).toHaveLength(0);
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
    expect(JSON.stringify(application.traces)).not.toContain(token);
  });
});
