import { afterEach, describe, expect, it } from "vitest";
import { IncidentChatHost } from "../src/chat/host.js";
import { ScriptedChatModel } from "../src/chat/model.js";
import { McpClientSession } from "../src/mcp/client.js";
import { startTestApplication, type TestApplication } from "./helpers.js";

const applications: TestApplication[] = [];
afterEach(async () => {
  await Promise.all(
    applications.splice(0).map((application) => application.close()),
  );
});

async function session(
  application: TestApplication,
  persona: "dana" | "amir" | "eve",
) {
  const token = await application.token(persona);
  return McpClientSession.connect({
    endpoint: application.endpoint,
    accessToken: token,
  });
}

describe("deterministic P3 permissive", () => {
  it("runs Dana, Amir, and Eve through the same host, MCP, and domain path", async () => {
    const application = await startTestApplication();
    applications.push(application);

    const danaMcp = await session(application, "dana");
    const dana = new IncidentChatHost({
      mcp: danaMcp,
      model: new ScriptedChatModel([
        {
          kind: "capability_call",
          name: "reconcile_capability_catalog",
          arguments: {},
        },
      ]),
      confirm: async () => true,
    });
    const danaReconciliation = await dana.connect();
    expect(danaReconciliation.isError).not.toBe(true);
    expect(await dana.send("Reconcile the capability catalog.")).toContain(
      '"status":"aligned"',
    );
    await danaMcp.close();

    const amirMcp = await session(application, "amir");
    const amir = new IncidentChatHost({
      mcp: amirMcp,
      model: new ScriptedChatModel([
        {
          kind: "capability_call",
          name: "search_incidents",
          arguments: { query: "payment", limit: 5 },
        },
        {
          kind: "capability_call",
          name: "incident_response_runbook",
          arguments: {},
        },
        {
          kind: "capability_call",
          name: "triage_incident",
          arguments: { incidentId: "INC-1001" },
        },
        {
          kind: "capability_call",
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
    await amir.connect();
    expect(await amir.send("Find the payment incident.")).toContain("INC-1001");
    expect(await amir.send("Read the runbook.")).toContain("Incident response");
    expect(await amir.send("Build a triage prompt.")).toContain(
      "Triage INC-1001",
    );
    expect(await amir.send("Advance the incident.")).toContain(
      '"status":"investigating"',
    );
    await amirMcp.close();

    const eveMcp = await session(application, "eve");
    const eve = new IncidentChatHost({
      mcp: eveMcp,
      model: new ScriptedChatModel([
        {
          kind: "capability_call",
          name: "search_incidents",
          arguments: { query: "notification", limit: 5 },
        },
        {
          kind: "capability_call",
          name: "update_incident_status",
          arguments: {
            incidentId: "INC-1002",
            expectedStatus: "investigating",
            nextStatus: "mitigated",
          },
        },
      ]),
      confirm: async () => true,
    });
    await eve.connect();
    expect(await eve.send("Search incidents.")).toContain("INC-1002");
    expect(await eve.send("Advance INC-1002.")).toContain(
      '"status":"mitigated"',
    );
    await eveMcp.close();

    expect(
      application.traces.some(
        (trace) =>
          trace.principal === "eve" && trace.capabilityId === "incident.update",
      ),
    ).toBe(true);
    expect(JSON.stringify(application.traces)).not.toContain("access-secret");
  }, 15_000);

  it("requires learner confirmation before a status-changing call", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const mcp = await session(application, "amir");
    const host = new IncidentChatHost({
      mcp,
      model: new ScriptedChatModel([
        {
          kind: "capability_call",
          name: "update_incident_status",
          arguments: {
            incidentId: "INC-1001",
            expectedStatus: "open",
            nextStatus: "investigating",
          },
        },
      ]),
      confirm: async () => false,
    });
    await host.connect();
    const before = application.traces.length;
    expect(await host.send("Advance INC-1001.")).toBe(
      "Status change cancelled.",
    );
    expect(application.traces).toHaveLength(before);
    await mcp.close();
  });

  it("reports schema drift observed through actual MCP discovery", async () => {
    const application = await startTestApplication();
    applications.push(application);
    const mcp = await session(application, "dana");
    const discovery = await mcp.discover();
    expect(discovery.reconciliation.structuredContent).toMatchObject({
      status: "aligned",
    });

    const changedObservation = discovery.observed.map((descriptor) =>
      descriptor.name === "search_incidents"
        ? { ...descriptor, schema: { type: "string" } }
        : descriptor,
    );
    const reconciliation = await mcp.reconcile(changedObservation);
    expect(reconciliation.structuredContent).toMatchObject({
      status: "drift",
      schemaMismatch: ["tool:search_incidents"],
    });
    await mcp.close();
  });

  it("reports drift, hides it from the model, and rejects direct execution", async () => {
    const application = await startTestApplication(true);
    applications.push(application);
    const mcp = await session(application, "dana");
    let observedTools:
      | Parameters<
          ConstructorParameters<typeof IncidentChatHost>[0]["model"]["next"]
        >[1]
      | undefined;
    const activity: string[] = [];
    const host = new IncidentChatHost({
      mcp,
      model: {
        async next(_messages, tools) {
          observedTools = tools;
          return { kind: "message", text: "Observed." };
        },
      },
      confirm: async () => true,
      activity: (message) => activity.push(message),
    });
    const reconciliation = await host.connect();
    expect(JSON.stringify(reconciliation.structuredContent)).toContain(
      "tool:export_incident_bundle",
    );
    expect(activity).toContain(
      "MCP catalog drift: tool:export_incident_bundle.",
    );
    await host.send("What is available?");
    const tools = observedTools ?? [];
    expect(tools.map(({ name }) => name)).not.toContain(
      "export_incident_bundle",
    );
    expect(
      tools.find(({ name }) => name === "update_incident_status")?.inputSchema,
    ).not.toMatchObject({
      required: expect.arrayContaining(["confirmed", "idempotencyKey"]),
    });
    expect(
      tools.find(({ name }) => name === "reconcile_capability_catalog")
        ?.inputSchema,
    ).not.toMatchObject({ required: expect.arrayContaining(["observed"]) });

    const direct = await mcp.callToolDirect("export_incident_bundle", {
      incidentId: "INC-1001",
    });
    expect(direct.isError).toBe(true);
    expect(JSON.stringify(direct.content)).toContain("unreviewed_capability");
    await mcp.close();
  });
});
