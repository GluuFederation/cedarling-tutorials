import { expect, it, vi } from "vitest";
import type { Actor } from "../src/server/database.ts";
import {
  type AuthorizationAdapter,
  CapabilityGateway,
} from "../src/server/service.ts";

const actor: Actor = { id: "bao", name: "Bao", role: "buyer", version: 1 };

it.each([
  undefined,
  { decision: "UNKNOWN", mode: "permissive" },
  { decision: "ALLOW", mode: "unknown" },
])(
  "rejects a malformed adapter decision without logging success (%j)",
  (result) => {
    const log = vi.fn();
    // Deliberately violate the adapter contract to exercise runtime validation.
    const adapter = (() => result) as AuthorizationAdapter;
    const gateway = new CapabilityGateway(adapter, log);
    expect(() =>
      gateway.authorize({
        capability: "refund.case.view",
        actor,
        requestId: "req-invalid",
        resource: {
          type: "Marketplace::RefundCase",
          id: "refund-bao-001",
          attributes: {},
        },
      }),
    ).toThrow(
      expect.objectContaining({ status: 503, code: "AUTHORIZATION_ERROR" }),
    );
    expect(log).not.toHaveBeenCalled();
  },
);

it("logs one compact decision without exposing request facts", () => {
  const log = vi.fn();
  const adapter = vi.fn(() => ({
    decision: "ALLOW" as const,
    mode: "permissive" as const,
  }));
  new CapabilityGateway(adapter, log).authorize({
    capability: "refund.case.view",
    actor,
    requestId: "req-view",
    resource: {
      type: "Marketplace::RefundCase",
      id: "refund-bao-001",
      attributes: {
        version: 2,
        orderVersion: 1,
        amountMinor: 999999,
        reason: "private reason",
      },
    },
    context: {
      buyerMatch: false,
      sellerMatch: false,
      supportCaseMatch: true,
      fraudCaseMatch: false,
      riskVersion: 3,
      assignmentCurrent: true,
      requesterDifferent: true,
      withinLimit: false,
      assignmentCaseMatch: true,
      currencyMatch: true,
      assigned: false,
      repeated: false,
      supportAssignmentCurrent: false,
      accessToken: "secret-token",
      reason: "private reason",
      amountMinor: 999999,
      riskCode: "private-risk",
      path: "/private/database",
      unknownFlag: true,
      proposedEffect: { amountMinor: 999999 },
    },
  });
  expect(log).toHaveBeenCalledTimes(1);
  const line = String(log.mock.calls[0]?.[0]);
  expect(line).toBe(
    "P15 server | FAKE ALLOW | refund.case.view | bao -> refund-bao-001 | req-view",
  );
  expect(line.split("\n")).toHaveLength(1);
  expect(adapter).toHaveBeenCalledWith(
    expect.objectContaining({
      resource: expect.objectContaining({
        attributes: {
          version: 2,
          orderVersion: 1,
          amountMinor: 999999,
          reason: "private reason",
        },
      }),
      context: expect.objectContaining({
        buyerMatch: false,
        supportCaseMatch: true,
        withinLimit: false,
        assignmentCurrent: true,
      }),
    }),
  );
  expect(line).not.toMatch(/private|secret|999999|unknownFlag|proposedEffect/);
});

it.each([false, true])(
  "keeps the denial status and compact trace (hidden: %s)",
  (hideDenial) => {
    const log = vi.fn();
    const gateway = new CapabilityGateway(
      () => ({ decision: "DENY", mode: "permissive" }),
      log,
    );
    expect(() =>
      gateway.authorize({
        capability: "refund.case.view",
        actor,
        requestId: "req-deny",
        resource: {
          type: "Marketplace::RefundCase",
          id: "refund-bao-001",
          attributes: {},
        },
        hideDenial,
      }),
    ).toThrow(
      expect.objectContaining({
        status: hideDenial ? 404 : 403,
        code: hideDenial ? "CASE_UNAVAILABLE" : "NOT_ALLOWED",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("P15 server | FAKE DENY | refund.case.view"),
    );
  },
);
