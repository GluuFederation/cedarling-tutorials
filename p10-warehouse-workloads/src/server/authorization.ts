import type { Capability, CedarAction } from "../shared/capabilities.ts";
import type { WorkloadId } from "../shared/catalog.ts";

export type AuthorizationRequest = Readonly<{
  requestId: string;
  workloadId: WorkloadId;
  capability: Capability;
  action: CedarAction;
  accessToken: string;
  resourceId: string;
  facts: Readonly<Record<string, string | number | boolean>>;
}>;

export interface Authorization {
  authorize(request: AuthorizationRequest): Promise<boolean>;
}

export function fakeAuthorization(
  log: (line: string) => void = console.info,
): Authorization {
  return {
    async authorize(request) {
      log(
        `P10 server | FAKE ALLOW | ${request.capability} | ${request.workloadId} -> ${request.resourceId} | ${request.requestId}`,
      );
      return true;
    },
  };
}
