import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import type { GovernanceCatalog, SurfaceKind } from "../catalog/types.js";
import { bindingFor, reconcileCatalog } from "../catalog/catalog.js";
import { runbookText, runbookUri, triagePrompt } from "../incidents/content.js";
import { DomainError } from "../incidents/errors.js";
import { IncidentRepository } from "../incidents/repository.js";
import type { PersonaId } from "../incidents/types.js";
import { MCP_PROTOCOL_VERSION } from "../config/project-config.js";
import {
  listCapabilitiesInput,
  reconcileInput,
  searchIncidentsInput,
  triagePromptArguments,
  updateIncidentInput,
} from "./schemas.js";
import { createPermissiveSeam, type FakeTrace } from "./trace.js";

type McpServices = Readonly<{
  catalog: GovernanceCatalog;
  incidents: IncidentRepository;
  driftMode: boolean;
  seam?: ReturnType<typeof createPermissiveSeam>;
}>;

function principalFrom(authInfo: AuthInfo | undefined): PersonaId {
  const subject = authInfo?.extra?.subject;
  if (subject === "dana" || subject === "amir" || subject === "eve") {
    return subject;
  }
  throw new Error("Authenticated P3 principal is missing");
}

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function safeToolError(error: unknown) {
  const code =
    error instanceof DomainError ? error.code : "operation_unavailable";
  return {
    isError: true,
    content: [{ type: "text" as const, text: code }],
  };
}

/**
 * Registers the same bounded MCP surface for every stateless request.
 * Request authentication is already complete when this factory is called.
 */
export function createIncidentMcpServer(
  authInfo: AuthInfo | undefined,
  services: McpServices,
): McpServer {
  const principal = principalFrom(authInfo);
  const seam = services.seam ?? createPermissiveSeam();
  const server = new McpServer(
    { name: "govops-incident-assistant", version: "0.0.1" },
    { supportedProtocolVersions: [MCP_PROTOCOL_VERSION] },
  );

  function review(
    kind: SurfaceKind,
    name: string,
    resource: string,
  ): FakeTrace {
    const binding = bindingFor(services.catalog, kind, name);
    if (!binding) throw new Error("unreviewed_capability");
    const capability = services.catalog.capabilities.get(binding.capabilityId);
    if (!capability) throw new Error("invalid_capability_binding");
    return seam(principal, binding.capabilityId, binding.cedarAction, resource);
  }

  server.registerTool(
    "reconcile_capability_catalog",
    {
      title: "Reconcile capability catalog",
      description:
        "Compare bounded MCP discovery with the reviewed ACC binding.",
      inputSchema: reconcileInput,
    },
    async ({ observed }) => {
      const trace = review(
        "tool",
        "reconcile_capability_catalog",
        "catalog:p3",
      );
      return json({
        requestId: trace.requestId,
        ...reconcileCatalog(services.catalog, observed),
      });
    },
  );

  server.registerTool(
    "list_capabilities",
    {
      title: "List reviewed capabilities",
      description: "List reviewed capability IDs and MCP surface identities.",
      inputSchema: listCapabilitiesInput,
    },
    async () => {
      const trace = review("tool", "list_capabilities", "catalog:p3");
      return json({
        requestId: trace.requestId,
        capabilities: services.catalog.bindings.map((binding) => ({
          capabilityId: binding.capabilityId,
          kind: binding.kind,
          name: binding.name,
        })),
      });
    },
  );

  server.registerTool(
    "search_incidents",
    {
      title: "Search incidents",
      description: "Search current synthetic incident summaries.",
      inputSchema: searchIncidentsInput,
    },
    async ({ query, limit }) => {
      const trace = review("tool", "search_incidents", "incident:collection");
      return json({
        requestId: trace.requestId,
        incidents: services.incidents
          .search(query, limit)
          .map(({ id, title, status, severity, assignedTo, version }) => ({
            id,
            title,
            status,
            severity,
            assignedTo,
            version,
          })),
      });
    },
  );

  server.registerTool(
    "update_incident_status",
    {
      title: "Update incident status",
      description: "Advance one incident through one confirmed lifecycle step.",
      inputSchema: updateIncidentInput,
    },
    async ({ incidentId, expectedStatus, nextStatus, idempotencyKey }) => {
      try {
        // Reload current state before the future authorization seam.
        services.incidents.get(incidentId);
        const trace = review(
          "tool",
          "update_incident_status",
          `incident:${incidentId}`,
        );
        const incident = services.incidents.updateStatus({
          incidentId,
          expectedStatus,
          nextStatus,
          idempotencyKey,
        });
        return json({
          requestId: trace.requestId,
          incident: {
            id: incident.id,
            status: incident.status,
            version: incident.version,
          },
        });
      } catch (error) {
        return safeToolError(error);
      }
    },
  );

  server.registerResource(
    "incident_response_runbook",
    runbookUri,
    {
      title: "Incident response runbook",
      description: "Synthetic bounded incident-response guidance.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const trace = review(
        "resource",
        "incident_response_runbook",
        "runbook:core",
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `Request: ${trace.requestId}\n\n${runbookText}`,
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "triage_incident",
    {
      title: "Triage incident",
      description: "Build a bounded triage conversation for one incident.",
      argsSchema: triagePromptArguments,
    },
    async ({ incidentId }) => {
      const incident = services.incidents.get(incidentId);
      const trace = review(
        "prompt",
        "triage_incident",
        `incident:${incidentId}`,
      );
      return {
        description: `Triage request ${trace.requestId}`,
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: triagePrompt(incident) },
          },
        ],
      };
    },
  );

  if (services.driftMode) {
    server.registerTool(
      "export_incident_bundle",
      {
        title: "Export incident bundle",
        description: "Controlled unreviewed drift fixture.",
        inputSchema: {
          incidentId: updateIncidentInput.shape.incidentId,
        },
      },
      async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "unreviewed_capability" }],
      }),
    );
  }
  return server;
}
