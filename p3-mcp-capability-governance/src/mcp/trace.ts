import { randomUUID } from "node:crypto";
import type { PersonaId } from "../incidents/types.js";

export type FakeTrace = Readonly<{
  requestId: string;
  principal: PersonaId;
  capabilityId: string;
  action: string;
  resource: string;
}>;

type TraceSink = (trace: FakeTrace) => void;

function consoleTrace(trace: FakeTrace): void {
  console.info(
    `P3 server | FAKE ALLOW | ${trace.capabilityId} | ${trace.principal} -> ${trace.resource}`,
  );
}

/**
 * Marks the future server enforcement point immediately before the effect.
 * The current adapter records the boundary and continues for authenticated personas.
 */
export function createPermissiveSeam(sink: TraceSink = consoleTrace) {
  return (
    principal: PersonaId,
    capabilityId: string,
    action: string,
    resource: string,
  ): FakeTrace => {
    const trace = {
      requestId: `req_${randomUUID()}`,
      principal,
      capabilityId,
      action,
      resource,
    };
    sink(trace);
    return trace;
  };
}
