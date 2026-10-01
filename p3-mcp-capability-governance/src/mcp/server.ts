/** Registers the caller's MCP surface and enforces decisions immediately before each effect. */
import { randomUUID } from "node:crypto";
import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { runbookText, runbookUri, triagePrompt } from "../incidents/content.js";
import { DomainError } from "../incidents/errors.js";
import type { IncidentRepository } from "../incidents/repository.js";
import { MCP_PROTOCOL_VERSION } from "../config/project-config.js";
import {
  searchIncidentsInput,
  triagePromptArguments,
  updateIncidentInput,
} from "./schemas.js";
import {
  authorize,
  AuthorizationError,
  type Action,
  type Resource,
} from "./authorization.js";

type McpServices = Readonly<{
  incidents: IncidentRepository;
  authorize: typeof authorize;
}>;
const service: Resource = { type: "Service", id: "incident-assistant" };

function json(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function safeToolError(error: unknown) {
  const code =
    error instanceof DomainError || error instanceof AuthorizationError
      ? error.code
      : "operation_unavailable";
  return { isError: true, content: [{ type: "text" as const, text: code }] };
}

export async function createIncidentMcpServer(
  authInfo: AuthInfo | undefined,
  services: McpServices,
): Promise<McpServer> {
  if (!authInfo) throw new AuthorizationError("authorization_denied");
  const requestId = randomUUID();
  const allowed = (action: Action, resource: Resource) =>
    services.authorize(authInfo, action, resource, requestId);
  async function requireAllowed(action: Action, resource: Resource) {
    if (!(await allowed(action, resource)))
      throw new AuthorizationError("authorization_denied");
  }
  function currentIncident(id: string) {
    try {
      return services.incidents.get(id);
    } catch (error) {
      // Missing and inaccessible targets do not disclose incident existence.
      if (error instanceof DomainError && error.code === "incident_not_found")
        throw new AuthorizationError("authorization_denied");
      throw error;
    }
  }

  // Explicit empty capabilities keep standard list requests valid for denied callers.
  const server = new McpServer(
    { name: "p3-incident-assistant", version: "0.0.1" },
    {
      supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
  );
  if (!(await allowed("Discover", service))) return server;

  server.registerTool(
    "search_incidents",
    {
      title: "Search incidents",
      description:
        "Search incident summaries available to the current account.",
      inputSchema: searchIncidentsInput,
    },
    async ({ query, limit }) => {
      try {
        await requireAllowed("Search", service);
        const incidents = [];
        for (const incident of services.incidents.search(query)) {
          if (
            await allowed("Read", {
              type: "Incident",
              id: incident.id,
              assignedTo: incident.assignedTo,
            })
          ) {
            const { id, title, status, severity, assignedTo, version } =
              incident;
            incidents.push({
              id,
              title,
              status,
              severity,
              assignedTo,
              version,
            });
            if (incidents.length === limit) break;
          }
        }
        return json({ requestId, incidents });
      } catch (error) {
        return safeToolError(error);
      }
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
        const current = currentIncident(incidentId);
        await requireAllowed("UpdateStatus", {
          type: "Incident",
          id: current.id,
          assignedTo: current.assignedTo,
        });
        // The repository rechecks the expected status synchronously at the effect.
        const incident = services.incidents.updateStatus({
          incidentId,
          expectedStatus,
          nextStatus,
          idempotencyKey,
        });
        return json({
          requestId,
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
      await requireAllowed("ReadRunbook", { type: "Runbook", id: "core" });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `Request: ${requestId}\n\n${runbookText}`,
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
      const incident = currentIncident(incidentId);
      await requireAllowed("Triage", {
        type: "Incident",
        id: incident.id,
        assignedTo: incident.assignedTo,
      });
      return {
        description: `Triage request ${requestId}`,
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
