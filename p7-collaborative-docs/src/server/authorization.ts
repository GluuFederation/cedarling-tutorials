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
      const decisions: Partial<Record<Capability, boolean>> = {};
      for (const request of requests) {
        decisions[request.capability] = await this.authorize(request);
      }
      return decisions;
    },
  };
}
