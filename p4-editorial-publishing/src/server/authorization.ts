export const capabilities = [
  "article.read",
  "revision.edit",
  "revision.submit",
  "revision.approve",
  "revision.reject",
  "publication.publish",
] as const;

export type Capability = (typeof capabilities)[number];
export type AuthorizationRequest = {
  requestId: string;
  capability: Capability;
  actor: string;
  resource: string;
  facts: Readonly<Record<string, boolean | number | string>>;
};

export interface AuthorizationGateway {
  authorize(request: AuthorizationRequest): Promise<boolean>;
}

export function baselineAllows(request: AuthorizationRequest): boolean {
  const fact = (name: string) => request.facts[name] === true;
  switch (request.capability) {
    case "article.read":
      return fact("tenantMatch");
    case "revision.edit":
    case "revision.submit":
      return fact("actorIsAuthor");
    case "revision.approve":
      return fact("editorAuthorityCurrent") || fact("selfReview");
    case "revision.reject":
      return fact("editorAuthorityCurrent") && !fact("selfReview");
    case "publication.publish":
      return fact("publisherAuthorityCurrent") && fact("approvalPresent");
  }
}

export class BaselineAuthorizationGateway implements AuthorizationGateway {
  async authorize(request: AuthorizationRequest): Promise<boolean> {
    const allowed = baselineAllows(request);
    console.info(
      `P4 server | FAKE ${allowed ? "ALLOW" : "DENY"} | ${request.capability} | ${request.actor} -> ${request.resource} | ${request.requestId}`,
    );
    return allowed;
  }
}
