import { expect, it, onTestFinished, vi } from "vitest";
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
function testStore() {
  const store = new Store(":memory:");
  onTestFinished(() => store.close());
  return store;
}
function fixture(
  adapter: AuthorizationAdapter = () => ({
    decision: "ALLOW",
    mode: "permissive",
  }),
) {
  const store = testStore();
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
});

it("looks up one order with the same current refund data as its queue entry", () => {
  const { store, service } = fixture();
  for (const order of store.orders())
    expect(store.order(order.id)).toEqual(order);
  expect(store.order("missing-order")).toBeUndefined();
  const { order } = service.createOrder(
    session("bao"),
    { bookId: "book-oauth-action", expectedVersion: 1 },
    "checkout",
  );
  expect(store.order(order.id)).toEqual(order);
  service.requestRefund(
    session("bao"),
    order.refund.id,
    { reasonCategory: "damaged", expectedVersion: 0 },
    "request",
  );
  expect(store.order(order.id)).toEqual(
    store.orders().find((value) => value.id === order.id),
  );
  expect(store.order(order.id)?.refund).toMatchObject({
    state: "requested",
    version: 1,
  });
});

it("completes a newly purchased book through all four marketplace relationships", () => {
  const { store, service } = fixture();
  const { order } = service.createOrder(
    session("bao"),
    { bookId: "book-oauth-action", expectedVersion: 1 },
    "checkout",
  );
  const id = order.refund.id;
  expect(service.orders(session("bao"), "orders").orders).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: order.id })]),
  );
  expect(service.refunds(session("diego"), "queue").refunds).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ caseId: id, state: "eligible" }),
    ]),
  );
  expect(
    service.requestRefund(
      session("bao"),
      id,
      {
        reasonCategory: "damaged",
        reason: "Cover damaged on arrival",
        expectedVersion: 0,
      },
      "request",
    ).state,
  ).toBe("requested");
  expect(
    service.view(session("sela"), id, "seller", "seller").refund,
  ).toMatchObject({ state: "requested" });
  expect(
    service.approve(session("diego"), id, { expectedVersion: 1 }, "approve")
      .state,
  ).toBe("approved-awaiting-fraud");
  const completed = service.review(
    session("nia"),
    id,
    { outcome: "clear", expectedVersion: 2 },
    "clear",
  );
  expect(completed).toMatchObject({
    state: "completed",
    effect: { synthetic: true },
  });
  expect(store.effect(id)).toMatchObject({ amountMinor: order.amountMinor });
  const replay = service.review(
    session("nia"),
    id,
    { outcome: "clear", expectedVersion: 2 },
    "retry",
  );
  if (!("effect" in replay) || !("effect" in completed))
    throw new Error("Missing completed effect");
  expect(replay.effect.id).toBe(completed.effect.id);
  expect(
    store.db
      .prepare(
        "SELECT count(*) AS count FROM refund_effects WHERE refundId = ?",
      )
      .get(id),
  ).toEqual({ count: 1 });
});

it.each([
  { label: "omitted", reason: undefined, stored: null },
  { label: "empty", reason: "", stored: null },
  { label: "whitespace only", reason: " \t\n\r ", stored: null },
  { label: "tab", reason: "Cover\tdamaged", stored: "Cover\tdamaged" },
  { label: "line feed", reason: "Cover\ndamaged", stored: "Cover\ndamaged" },
  {
    label: "carriage return",
    reason: "Cover\rdamaged",
    stored: "Cover\rdamaged",
  },
  { label: "240 characters", reason: "a".repeat(240), stored: "a".repeat(240) },
  {
    label: "240 characters with surrounding whitespace",
    reason: ` \t${"a".repeat(240)}\r\n `,
    stored: "a".repeat(240),
  },
])("accepts a refund reason that is $label", ({ reason, stored }) => {
  const { store, service } = fixture();
  const result = service.requestRefund(
    session("bao"),
    "refund-bao-001",
    {
      reasonCategory: "damaged",
      expectedVersion: 0,
      ...(reason === undefined ? {} : { reason }),
    },
    "reason",
  );
  expect(result).toMatchObject({ state: "requested", version: 1 });
  expect(store.refund("refund-bao-001")?.reason).toBe(stored);
});

it("rejects prohibited control characters without changing the refund", () => {
  const { store, service } = fixture();
  const before = store.refund("refund-bao-001");
  const codes = [...Array.from({ length: 32 }, (_, code) => code), 127].filter(
    (code) => ![9, 10, 13].includes(code),
  );
  for (const code of codes) {
    expect(() =>
      service.requestRefund(
        session("bao"),
        "refund-bao-001",
        {
          reasonCategory: "damaged",
          reason: `Cover${String.fromCharCode(code)}damaged`,
          expectedVersion: 0,
        },
        "invalid-control",
      ),
    ).toThrow(/Refund request is invalid/);
    expect(store.refund("refund-bao-001")).toEqual(before);
  }
});

it.each([
  { label: "241 characters", reason: "a".repeat(241) },
  {
    label: "241 characters with surrounding whitespace",
    reason: ` \t${"a".repeat(241)}\r\n `,
  },
])("rejects $label in a refund reason", ({ reason }) => {
  const { store, service } = fixture();
  const before = store.refund("refund-bao-001");
  expect(() =>
    service.requestRefund(
      session("bao"),
      "refund-bao-001",
      { reasonCategory: "damaged", reason, expectedVersion: 0 },
      "long-reason",
    ),
  ).toThrow(/Refund request is invalid/);
  expect(store.refund("refund-bao-001")).toEqual(before);
});

it("protects each catalog and queue read through its named capability", () => {
  const actions: string[] = [];
  const { service } = fixture((request) => {
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
});

it("gives support the request context while all accounts can open every view", () => {
  const { service } = fixture();
  for (const actor of ["bao", "sela", "diego", "nia"] as const) {
    for (const view of ["buyer", "seller", "support", "fraud"] as const) {
      const result = service.view(
        session(actor),
        "refund-requested-001",
        view,
        "view",
      ).refund;
      expect(result.view).toBe(view);
      if (view === "support") {
        expect(result).toMatchObject({
          reasonCategory: "not-received",
          reason: "The package did not arrive.",
          requestedAt: expect.any(Number),
        });
      }
    }
  }
  expect(
    service.view(session("diego"), "refund-bao-001", "support", "empty").refund,
  ).toMatchObject({
    reasonCategory: null,
    reason: null,
    requestedAt: null,
    fraudStatus: "not-started",
  });
});

it("seeds matching customer reasons without changing the deliberate permission gaps", () => {
  const { store } = fixture();
  for (const id of ["refund-requested-001", "refund-completed-001"]) {
    expect(store.refund(id)).toMatchObject({
      reasonCategory: "not-received",
      reason: "The package did not arrive.",
    });
  }
  expect(store.refund("refund-blocked-001")).toMatchObject({
    reasonCategory: "item-not-as-described",
  });
  for (const id of ["refund-scope-gap-001", "refund-limit-gap-001"]) {
    expect(store.refund(id)?.reason).not.toMatch(/actor|approval limit/i);
  }
  expect(store.refund("refund-scope-gap-001")?.requestedBy).toBe("nia");
  expect(store.support("diego", "refund-scope-gap-001")).toBeUndefined();
  expect(store.support("diego", "refund-limit-gap-001")?.limitMinor).toBe(4000);
});

it("reports fraud progress from the actual lifecycle", () => {
  const { service } = fixture();
  for (const [id, status] of [
    ["refund-bao-001", "not-started"],
    ["refund-requested-001", "not-started"],
    ["refund-approved-001", "pending"],
    ["refund-completed-001", "cleared"],
    ["refund-blocked-001", "blocked"],
  ] as const) {
    expect(
      service.view(session("diego"), id, "support", "status").refund,
    ).toMatchObject({ fraudStatus: status });
  }
});

it("shows effective assignment status without enforcing it in the baseline", () => {
  const { store, service } = fixture();
  const read = () =>
    service.view(session("diego"), "refund-requested-001", "support", "status")
      .refund;
  expect(read()).toMatchObject({ assignment: { status: "active" } });
  store.db
    .prepare(
      "UPDATE support_assignments SET expiresAt=1800000000000 WHERE refundId='refund-requested-001'",
    )
    .run();
  expect(read()).toMatchObject({
    assignment: { status: "expired", expiresAt: 1800000000000 },
  });
  expect(store.support("diego", "refund-requested-001")?.status).toBe("active");
  service.approve(
    session("diego"),
    "refund-requested-001",
    { expectedVersion: 1 },
    "expired-allow",
  );
  expect(store.refund("refund-requested-001")?.state).toBe(
    "approved-awaiting-fraud",
  );
  store.db
    .prepare(
      "UPDATE support_assignments SET status='revoked' WHERE refundId='refund-requested-001'",
    )
    .run();
  expect(read()).toMatchObject({ assignment: { status: "revoked" } });
  store.db
    .prepare(
      "DELETE FROM support_assignments WHERE refundId='refund-requested-001'",
    )
    .run();
  expect(read()).toMatchObject({
    assignment: { status: "missing", expiresAt: null },
  });
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
});

it("shows the permissive gaps while sending the deciding facts", () => {
  const requests: Parameters<AuthorizationAdapter>[0][] = [];
  const { service } = fixture((request) => {
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
});

it("keeps lifecycle, stale versions, and denial closed natively", () => {
  const { service } = fixture();
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
});

it("rechecks mutable decision facts before committing the effect", () => {
  const store = testStore();
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
});
