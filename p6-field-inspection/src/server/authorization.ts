import type { Capability } from "../shared/capabilities.ts";

export type AuthorizationRequest = Readonly<{
  requestId: string;
  capability: Capability;
  principalId: string;
  resourceId: string;
}>;

export interface AuthorizationPort {
  readonly mode?: "fake";
  authorize(request: AuthorizationRequest): Promise<boolean>;
  authorizeMany(
    requests: readonly AuthorizationRequest[],
  ): Promise<Readonly<Record<Capability, boolean>>>;
}

export function fakeAuthorization(): AuthorizationPort {
  return {
    mode: "fake",
    async authorize(request) {
      console.info(
        `P6 server | FAKE ALLOW | ${request.capability} | ${request.principalId} -> ${request.resourceId} | ${request.requestId}`,
      );
      return true;
    },
    async authorizeMany(requests) {
      const decisions = {} as Record<Capability, boolean>;
      for (const request of requests) {
        decisions[request.capability] = await this.authorize(request);
      }
      return decisions;
    },
  };
}
