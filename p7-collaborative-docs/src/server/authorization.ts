import type { Capability } from "../shared/capabilities.ts";

export type AuthorizationRequest = Readonly<{
  requestId: string;
  capability: Capability;
  principalId: string;
  resourceId: string;
  facts: Readonly<Record<string, unknown>>;
}>;

export interface AuthorizationPort {
  authorize(request: AuthorizationRequest): Promise<boolean>;
  authorizeMany(
    requests: readonly AuthorizationRequest[],
  ): Promise<Readonly<Partial<Record<Capability, boolean>>>>;
}

export function fakeAuthorization(): AuthorizationPort {
  return {
    async authorize(request) {
      console.info(
        `P7 server | FAKE ALLOW | ${request.capability} | ${request.principalId} -> ${request.resourceId} | ${request.requestId}`,
      );
      return true;
    },
    async authorizeMany(requests) {
      const first = requests[0];
      if (!first) return {};
      console.info(
        `P7 server | FAKE ALLOW | ${requests.map((item) => item.capability).join(",")} | ${first.principalId} -> ${first.resourceId} | ${first.requestId}`,
      );
      const decisions: Partial<Record<Capability, boolean>> = {};
      for (const request of requests) decisions[request.capability] = true;
      return decisions;
    },
  };
}
