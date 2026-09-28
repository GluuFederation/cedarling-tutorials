import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { runbookText, runbookUri, triagePrompt } from "../incidents/content.js";
import { DomainError } from "../incidents/errors.js";
import { IncidentRepository } from "../incidents/repository.js";
import type { PersonaId } from "../incidents/types.js";
import { MCP_PROTOCOL_VERSION } from "../config/project-config.js";
import {
  searchIncidentsInput,
  triagePromptArguments,
  updateIncidentInput,
} from "./schemas.js";
import { createPermissiveSeam } from "./trace.js";

type McpServices = Readonly<{
  incidents: IncidentRepository;
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
    { name: "p3-incident-assistant", version: "0.0.1" },
    { supportedProtocolVersions: [MCP_PROTOCOL_VERSION] },
  );

  server.registerTool(
    "search_incidents",
    {
      title: "Search incidents",
      description: "Search current synthetic incident summaries.",
      inputSchema: searchIncidentsInput,
    },
    async ({ query, limit }) => {
      const trace = seam(
        principal,
        "incident.search",
        "Incident::Search",
        "incident:collection",
      );
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
        const trace = seam(
          principal,
          "incident.update",
          "Incident::UpdateStatus",
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
      const trace = seam(
        principal,
        "runbook.read",
        "Runbook::Read",
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
      const trace = seam(
        principal,
        "incident.triage",
        "Incident::Triage",
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

  return server;
}
