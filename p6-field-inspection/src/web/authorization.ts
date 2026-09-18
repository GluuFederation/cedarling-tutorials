import type { Capability } from "../shared/capabilities.ts";

/** Baseline browser policy seam; Cedarling replaces this permissive adapter. */
export function authorizePresentation(input: {
  capability: Capability;
  principalId: string;
  resourceId: string;
}): boolean {
  console.info(
    `P6 browser | FAKE ALLOW | ${input.capability} | ${input.principalId} -> ${input.resourceId}`,
  );
  return true;
}
