import { z } from "zod";
import { incidentStatuses } from "../incidents/types.js";

export const searchIncidentsInput = z
  .object({
    query: z.string().trim().min(1).max(120),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();
export const updateIncidentInput = z
  .object({
    incidentId: z.string().regex(/^INC-[0-9]{4}$/),
    expectedStatus: z.enum(incidentStatuses),
    nextStatus: z.enum(incidentStatuses),
    confirmed: z.literal(true),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  })
  .strict();
export const triagePromptArguments = z
  .object({ incidentId: z.string().regex(/^INC-[0-9]{4}$/) })
  .strict();
