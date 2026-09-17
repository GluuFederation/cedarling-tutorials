import type { Capability } from "../shared/capabilities.ts";

export type AuthorizationRequest = Readonly<{
  requestId: string;
  capability: Capability;
  principalId: string;
  resourceId: string;
}>;

export interface AuthorizationPort {
  authorize(request: AuthorizationRequest): Promise<boolean>;
  authorizeMany(
    requests: readonly AuthorizationRequest[],
  ): Promise<Readonly<Record<Capability, boolean>>>;
}

export function fakeAuthorization(): AuthorizationPort {
  return {
    async authorize(request) {
      console.info(
        `P6 server | FAKE ALLOW | ${request.capability} | ${request.principalId} -> ${request.resourceId} | ${request.requestId}`,
      );
      return true;
    },
    async authorizeMany(requests) {
      const first = requests[0];
      if (!first) return {} as Readonly<Record<Capability, boolean>>;
      console.info(
        `P6 server | FAKE ALLOW | ${requests.map((item) => item.capability).join(",")} | ${first.principalId} -> ${first.resourceId} | ${first.requestId}`,
      );
      return Object.fromEntries(
        requests.map((request) => [request.capability, true]),
      ) as Readonly<Record<Capability, boolean>>;
    },
  };
}
