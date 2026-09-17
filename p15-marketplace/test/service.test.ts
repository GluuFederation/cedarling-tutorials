import { expect, it, vi } from "vitest";
import { type Session, Store } from "../src/server/database.ts";
import {
  type AuthorizationAdapter,
  CapabilityGateway,
  MarketplaceService,
} from "../src/server/service.ts";
import type { ActorId } from "../src/shared/protocol.ts";

const session = (actorId: ActorId): Session => ({
  hash: actorId,
  actorId,
  csrf: "csrf",
  encryptedTokens: "tokens",
  expiresAt: Date.now() + 100_000,
});
function fixture(
  adapter: AuthorizationAdapter = () => ({
    decision: "ALLOW",
    mode: "permissive",
  }),
) {
  const store = new Store(":memory:");
  const service = new MarketplaceService(
    store,
    new CapabilityGateway(adapter, vi.fn()),
    () => 1_800_000_000_000,
  );
  return { store, service };
}

it("seeds five books and a visible lifecycle queue", () => {
  const { store } = fixture();
  expect(store.db.pragma("user_version", { simple: true })).toBe(1);
  expect(store.books()).toHaveLength(5);
  expect(store.orders()).toHaveLength(9);
  expect(store.refunds().map((value) => value.state)).toEqual(
    expect.arrayContaining([
      "eligible",
      "requested",
      "approved-awaiting-fraud",
      "completed",
      "fraud-blocked",
    ]),
  );
  expect(store.support("diego", "refund-bao-001")).toMatchObject({
    limitMinor: 20_000,
    status: "active",
  });
  store.close();
});

it("creates a server-priced fulfilled order and eligible refund atomically", () => {
  const { store, service } = fixture();
  const result = service.createOrder(
    session("nia"),
    { bookId: "book-oauth-action", expectedVersion: 1 },
    "buy",
  );
  expect(result.order).toMatchObject({
    buyerId: "nia",
    amountMinor: 4_999,
    paymentState: "paid",
    fulfillmentState: "fulfilled",
    refund: { state: "eligible", version: 0 },
  });
  expect(store.refund(result.order.refund.id)?.amountMinor).toBe(4_999);
  expect(() =>
    service.createOrder(
      session("nia"),
      { bookId: "book-oauth-action", amountMinor: 1, expectedVersion: 1 },
      "forged",
    ),
  ).toThrow(/fields/i);
  store.close();
});

it("protects each catalog and queue read through its named capability", () => {
  const actions: string[] = [];
  const { store, service } = fixture((request) => {
    actions.push(request.action.id);
    return { decision: "ALLOW", mode: "permissive" };
  });
  service.catalog(session("bao"), "catalog");
  service.orders(session("bao"), "orders");
  service.refunds(session("bao"), "refunds");
  service.view(session("bao"), "refund-bao-001", "buyer", "view");
  expect(actions).toEqual([
    "Marketplace::ListCatalog",
    "Marketplace::ListOrders",
    "Marketplace::ListRefunds",
    "Marketplace::ViewRefundCase",
  ]);
  store.close();
});

it("returns four bounded relationship projections for the selected case", () => {
  const { store, service } = fixture();
  store.db
    .prepare("UPDATE actors SET name='D. Support' WHERE id='diego'")
    .run();
  store.db.prepare("UPDATE actors SET name='N. Fraud' WHERE id='nia'").run();
  const buyer = service.view(
    session("bao"),
    "refund-requested-001",
    "buyer",
    "buyer",
  ).refund;
  const seller = service.view(
    session("bao"),
    "refund-requested-001",
    "seller",
    "seller",
  ).refund;
  const support = service.view(
    session("bao"),
    "refund-requested-001",
    "support",
    "support",
  ).refund;
  const fraud = service.view(
    session("bao"),
    "refund-requested-001",
    "fraud",
    "fraud",
  ).refund;
  expect(buyer).toMatchObject({ view: "buyer", expectedBuyer: "Bao" });
  expect(seller).toMatchObject({
    view: "seller",
    expectedSeller: "Sela Books",
  });
  expect(support).toMatchObject({
    view: "support",
    expectedApprover: "D. Support",
    nextActorDisplayName: "D. Support",
    assignment: { status: "active" },
  });
  expect(fraud).toMatchObject({
    view: "fraud",
    expectedReviewer: "N. Fraud",
    riskLabel: "Standard payment review",
  });
  expect(seller).not.toHaveProperty("reason");
  expect(fraud).not.toHaveProperty("reason");
  store.close();
});

it("keeps one current support and fraud assignment per refund", () => {
  const { store } = fixture();
  expect(() =>
    store.db
      .prepare(`
        INSERT INTO support_assignments
          (id, actorId, refundId, currency, limitMinor, expiresAt, status, version)
        VALUES ('duplicate-support', 'diego', 'refund-bao-001', 'USD', 20000,
          4102444800000, 'active', 1)
      `)
      .run(),
  ).toThrow(/unique/i);
  expect(() =>
    store.db
      .prepare(`
        INSERT INTO fraud_assignments
          (id, actorId, refundId, status, version)
        VALUES ('duplicate-fraud', 'nia', 'refund-bao-001', 'active', 1)
      `)
      .run(),
  ).toThrow(/unique/i);
  store.close();
});

it("persists the normal refund lifecycle and exactly one effect", () => {
  const { store, service } = fixture();
  expect(
    service.requestRefund(
      session("bao"),
      "refund-bao-001",
      { reasonCategory: "damaged", reason: "Bent cover", expectedVersion: 0 },
      "request",
    ).state,
  ).toBe("requested");
  expect(
    service.approve(
      session("diego"),
      "refund-bao-001",
      { expectedVersion: 1 },
      "approve",
    ).state,
  ).toBe("approved-awaiting-fraud");
  const completed = service.review(
    session("nia"),
    "refund-bao-001",
    { outcome: "clear", expectedVersion: 2 },
    "clear",
  );
  expect(completed).toMatchObject({
    state: "completed",
    effect: { synthetic: true },
  });
  const retry = service.review(
    session("nia"),
    "refund-bao-001",
    { outcome: "clear", expectedVersion: 2 },
    "retry",
  );
  if (!("effect" in completed) || !("effect" in retry))
    throw new Error("Clear did not return its effect");
  expect(retry.effect.id).toBe(completed.effect.id);
  expect(store.effect("refund-bao-001")).toMatchObject({
    amountMinor: 5_499,
    supportAssignmentVersion: 1,
    fraudAssignmentVersion: 1,
  });
  store.close();
});

it("shows the permissive gaps while sending the deciding facts", () => {
  const requests: Parameters<AuthorizationAdapter>[0][] = [];
  const { store, service } = fixture((request) => {
    requests.push(request);
    return { decision: "ALLOW", mode: "permissive" };
  });
  service.requestRefund(
    session("nia"),
    "refund-bao-001",
    { reasonCategory: "damaged", expectedVersion: 0 },
    "wrong-buyer",
  );
  expect(requests.at(-1)?.context).toMatchObject({ buyerMatch: false });
  service.approve(
    session("bao"),
    "refund-scope-gap-001",
    { expectedVersion: 1 },
    "wrong-approver",
  );
  expect(requests.at(-1)?.context).toMatchObject({
    assignmentCaseMatch: false,
    withinLimit: false,
  });
  service.approve(
    session("diego"),
    "refund-limit-gap-001",
    { expectedVersion: 1 },
    "over-limit",
  );
  expect(requests.at(-1)?.context).toMatchObject({
    assignmentCaseMatch: true,
    withinLimit: false,
  });
  store.close();
});

it("keeps lifecycle, stale versions, and denial closed natively", () => {
  const { store, service } = fixture();
  expect(() =>
    service.approve(
      session("diego"),
      "refund-bao-001",
      { expectedVersion: 0 },
      "early",
    ),
  ).toThrow(/no longer applies/i);
  expect(() =>
    service.requestRefund(
      session("bao"),
      "refund-bao-001",
      { reasonCategory: "damaged", expectedVersion: 9 },
      "stale",
    ),
  ).toThrow(/state changed/i);
  store.close();
  const denied = fixture(() => ({ decision: "DENY", mode: "permissive" }));
  expect(() =>
    denied.service.requestRefund(
      session("bao"),
      "refund-bao-001",
      { reasonCategory: "damaged", expectedVersion: 0 },
      "deny",
    ),
  ).toThrow(/not allowed/i);
  expect(denied.store.refund("refund-bao-001")?.state).toBe("eligible");
  denied.store.close();
});

it("blocks without creating a financial effect", () => {
  const { store, service } = fixture();
  const result = service.review(
    session("nia"),
    "refund-approved-001",
    { outcome: "block", expectedVersion: 2 },
    "block",
  );
  expect(result.state).toBe("fraud-blocked");
  expect(store.effect("refund-approved-001")).toBeUndefined();
  store.close();
});

it("rechecks mutable decision facts before committing the effect", () => {
  const store = new Store(":memory:");
  const service = new MarketplaceService(
    store,
    new CapabilityGateway((request) => {
      if (request.action.id === "Marketplace::ReviewFraud")
        store.db
          .prepare("UPDATE risk_signals SET version=version+1 WHERE refundId=?")
          .run(request.resource.id);
      return { decision: "ALLOW", mode: "permissive" };
    }, vi.fn()),
  );
  expect(() =>
    service.review(
      session("nia"),
      "refund-approved-001",
      { outcome: "clear", expectedVersion: 2 },
      "changed-facts",
    ),
  ).toThrow(/state changed/i);
  expect(store.refund("refund-approved-001")?.state).toBe(
    "approved-awaiting-fraud",
  );
  expect(store.effect("refund-approved-001")).toBeUndefined();
  store.close();
});
