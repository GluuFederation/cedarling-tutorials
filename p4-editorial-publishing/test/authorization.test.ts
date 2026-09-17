import { describe, expect, it } from "vitest";
import {
  type AuthorizationRequest,
  baselineAllows,
  capabilities,
} from "../src/server/authorization.ts";

const request = (
  capability: AuthorizationRequest["capability"],
  facts: AuthorizationRequest["facts"],
): AuthorizationRequest => ({
  requestId: "request-test",
  capability,
  actor: "riley",
  resource: "revision-test",
  facts,
});

describe("baseline authorization seam", () => {
  it("defines one decision for every editorial capability", () => {
    expect(capabilities).toHaveLength(6);
    for (const capability of capabilities) {
      expect(baselineAllows(request(capability, {}))).toBe(false);
    }
  });

  it.each([
    ["article.read", { tenantMatch: true }],
    ["revision.edit", { actorIsAuthor: true }],
    ["revision.submit", { actorIsAuthor: true }],
    ["revision.approve", { editorAuthorityCurrent: true }],
    ["revision.approve", { selfReview: true }],
    ["revision.reject", { editorAuthorityCurrent: true, selfReview: false }],
    [
      "publication.publish",
      { publisherAuthorityCurrent: true, approvalPresent: true },
    ],
  ] as const)("allows %s with its baseline facts", (capability, facts) => {
    expect(baselineAllows(request(capability, facts))).toBe(true);
  });

  it.each([
    ["article.read", { tenantMatch: false }],
    ["revision.edit", { actorIsAuthor: false }],
    ["revision.submit", { actorIsAuthor: false }],
    ["revision.approve", { selfReview: false, editorAuthorityCurrent: false }],
    ["revision.reject", { editorAuthorityCurrent: true, selfReview: true }],
    ["publication.publish", { approvalPresent: true }],
  ] as const)("denies %s without its required facts", (capability, facts) => {
    expect(baselineAllows(request(capability, facts))).toBe(false);
  });
});
