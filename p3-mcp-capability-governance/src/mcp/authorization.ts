/** Calls the private Cedarling AuthZen sidecar with signed identity and current server facts. */
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { parsePersona, type PersonaId } from "../incidents/types.js";

export type Action =
  "Discover" | "Search" | "Read" | "UpdateStatus" | "ReadRunbook" | "Triage";
export type Resource =
  | Readonly<{ type: "Service" | "Runbook"; id: string }>
  | Readonly<{ type: "Incident"; id: string; assignedTo: PersonaId | null }>;

// These are the application's account profiles, not token-derived permissions.
const roles: Record<PersonaId, string> = {
  dana: "supervisor",
  amir: "analyst",
  eve: "observer",
};
const decisionResponse = z.object({
  decision: z.boolean(),
  context: z.record(z.string(), z.unknown()),
});

export class AuthorizationError extends Error {
  constructor(
    public readonly code: "authorization_denied" | "authorization_unavailable",
  ) {
    super(code);
    this.name = "AuthorizationError";
  }
}

export async function authorize(
  auth: AuthInfo,
  action: Action,
  resource: Resource,
  requestId: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const subject = parsePersona(
    typeof auth.extra?.subject === "string" ? auth.extra.subject : undefined,
  );
  let decision: boolean;
  const details = {
    requestId,
    actorId: subject,
    action,
    resource: { type: resource.type, id: resource.id },
  };
  let httpStatus: number | undefined;
  try {
    const response = await request(
      "http://127.0.0.1:5000/cedarling/evaluation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
        body: JSON.stringify({
          subject: {
            type: "JWT",
            id: subject,
            properties: {
              tokens: [
                {
                  mapping: "P3IncidentAssistant::Access_token",
                  payload: auth.token,
                },
              ],
            },
          },
          action: { name: `P3IncidentAssistant::Action::"${action}"` },
          resource: {
            type: resource.type,
            id: resource.id,
            properties: {
              cedar_entity_mapping: {
                entity_type: `P3IncidentAssistant::${resource.type}`,
                id: resource.id,
              },
              ...(resource.type === "Incident" && resource.assignedTo !== null
                ? { assigned_to: resource.assignedTo }
                : {}),
            },
          },
          context: { caller: { subject, role: roles[subject] } },
        }),
      },
    );
    httpStatus = response.status;
    if (!response.ok) throw new Error("Sidecar HTTP failure");
    const result = decisionResponse.parse(await response.json());
    // The pinned sidecar reports runtime exceptions inside an HTTP 200 response.
    if (result.context.id === "-1")
      throw new Error("Sidecar evaluation failed");
    decision = result.decision;
  } catch {
    console.error(
      JSON.stringify(
        {
          event: "authorization.failed",
          ...details,
          code: "authorization_unavailable",
          httpStatus,
        },
        null,
        2,
      ),
    );
    throw new AuthorizationError("authorization_unavailable");
  }
  console.info(
    JSON.stringify(
      {
        event: "authorization.decision",
        ...details,
        decision: decision ? "ALLOW" : "DENY",
      },
      null,
      2,
    ),
  );
  return decision;
}
