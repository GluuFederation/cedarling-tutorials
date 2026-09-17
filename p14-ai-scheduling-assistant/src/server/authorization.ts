import type { Capability } from "../shared/tool-catalog.ts";

export type AuthorizationRequest = Readonly<{
  requestId: string;
  capability: Capability;
  action: string;
  principalId: string;
  resourceId: string;
  accessToken: string;
  facts: Readonly<Record<string, unknown>>;
  context: Readonly<{
    assistantId: "cedarschedule";
    assistantMediated: boolean;
    proposalId?: string;
  }>;
}>;

export interface AuthorizationPort {
  authorize(request: AuthorizationRequest): Promise<boolean>;
}

export function fakeAuthorization(): AuthorizationPort {
  return {
    async authorize(request) {
      console.info(
        `P14 server | FAKE ALLOW | ${request.capability} | ${request.principalId} -> ${request.resourceId} | ${request.requestId}`,
      );
      return true;
    },
  };
}
