import { z } from "zod";

const runtimeDescriptor = z
  .object({
    kind: z.enum(["tool", "resource", "prompt"]),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    schema: z.record(z.string().max(100), z.unknown()),
  })
  .strict();

export const reconcileInput = z
  .object({ observed: z.array(runtimeDescriptor).min(1).max(12) })
  .strict();
export const listCapabilitiesInput = z.object({}).strict();
export const searchIncidentsInput = z
  .object({
    query: z.string().trim().min(1).max(120),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();
export const updateIncidentInput = z
  .object({
    incidentId: z.string().regex(/^INC-[0-9]{4}$/),
    expectedStatus: z.enum(["open", "investigating", "mitigated", "resolved"]),
    nextStatus: z.enum(["open", "investigating", "mitigated", "resolved"]),
    confirmed: z.literal(true),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  })
  .strict();
export const triagePromptArguments = z
  .object({ incidentId: z.string().regex(/^INC-[0-9]{4}$/) })
  .strict();

/** Stable request shape used to bind one discovered static resource URI. */
export function resourceRequestSchema(
  uri: string,
): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    properties: {
      uri: { const: uri, type: "string" },
    },
    required: ["uri"],
    additionalProperties: false,
  };
}
