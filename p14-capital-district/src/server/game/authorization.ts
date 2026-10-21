import type { Authorizer } from "../../shared/contracts.ts";

export const fixedFakeAllow: Authorizer = {
  async decide({ actor, action, resourceId, requestId }) {
    console.info(
      `P14 server | FAKE ALLOW | ${action} | ${actor.id} -> ${resourceId} | ${requestId}`,
    );
    return { decision: true };
  },
};
