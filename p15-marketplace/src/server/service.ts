import { randomUUID } from "node:crypto";
import {
  type Capability,
  capabilities,
  type FraudProjection,
  type ProjectionIntent,
  projectionIntents,
  type ReasonCategory,
  type RefundProjection,
  reasonCategories,
  type SellerProjection,
  type SupportProjection,
} from "../shared/protocol.ts";
import type {
  Actor,
  FraudAssignment,
  RefundSnapshot,
  Session,
  Store,
  SupportAssignment,
} from "./database.ts";
import { AppError, conflict, object } from "./security.ts";

export type AuthorizationRequest = {
  principal: { type: "Marketplace::Actor"; id: string; attributes: object };
  action: { type: "Marketplace::Action"; id: string };
  resource: { type: string; id: string; attributes: object };
  context: Record<string, unknown>;
};
export type AuthorizationDecision = {
  decision: "ALLOW" | "DENY";
  mode: "permissive";
};
export type AuthorizationAdapter = (
  request: AuthorizationRequest,
) => AuthorizationDecision;

const fakePermissiveAdapter: AuthorizationAdapter = () => ({
  decision: "ALLOW",
  mode: "permissive",
});

type AuthorizeInput = {
  capability: Capability;
  actor: Actor;
  requestId: string;
  resource: { type: string; id: string; attributes: object };
  context?: Record<string, unknown>;
  hideDenial?: boolean;
};

export class CapabilityGateway {
  private readonly adapter: AuthorizationAdapter;
  private readonly log: (line: string) => void;
  constructor(
    adapter: AuthorizationAdapter = fakePermissiveAdapter,
    log: (line: string) => void = console.info,
  ) {
    this.adapter = adapter;
    this.log = log;
  }

  authorize(input: AuthorizeInput): AuthorizationDecision {
    const action = capabilities[input.capability]?.action;
    if (!action) throw authorizationError();
    let result: AuthorizationDecision;
    try {
      result = this.adapter({
        principal: {
          type: "Marketplace::Actor",
          id: input.actor.id,
          attributes: { role: input.actor.role, version: input.actor.version },
        },
        action: { type: "Marketplace::Action", id: action },
        resource: input.resource,
        context: input.context ?? {},
      });
    } catch {
      throw new AppError(
        503,
        "AUTHORIZATION_UNAVAILABLE",
        "Authorization is unavailable. Retry.",
      );
    }
    if (!validDecision(result)) throw authorizationError();
    this.log(
      `P15 server | FAKE ${result.decision} | ${input.capability} | ${input.actor.id} -> ${input.resource.id}`,
    );
    if (result.decision === "DENY") {
      if (input.hideDenial) throw unavailableCase();
      throw new AppError(403, "NOT_ALLOWED", "Action is not allowed.");
    }
    return result;
  }
}

export class MarketplaceService {
  private readonly store: Store;
  private readonly gateway: CapabilityGateway;
  private readonly now: () => number;
  constructor(
    store: Store,
    gateway: CapabilityGateway,
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.gateway = gateway;
    this.now = now;
  }

  catalog(session: Session, requestId: string) {
    const actor = this.store.actor(session.actorId);
    this.authorizeCollection("catalog.list", actor, "Catalog::p15", requestId);
    return { books: this.store.books() };
  }

  orders(session: Session, requestId: string) {
    const actor = this.store.actor(session.actorId);
    this.authorizeCollection("order.list", actor, "Order::queue", requestId);
    return { orders: this.store.orders() };
  }

  createOrder(session: Session, input: unknown, requestId: string) {
    const body = object(input, ["bookId", "expectedVersion"]);
    if (typeof body.bookId !== "string" || !validVersion(body.expectedVersion))
      throw new AppError(
        400,
        "INVALID_INPUT",
        "Book and version are required.",
      );
    return this.store.db
      .transaction(() => {
        const actor = this.store.actor(session.actorId);
        const book = this.store.book(body.bookId as string);
        if (!book)
          throw new AppError(404, "BOOK_UNAVAILABLE", "Book is unavailable.");
        if (book.version !== body.expectedVersion) throw conflict();
        this.gateway.authorize({
          capability: "order.create",
          actor,
          requestId,
          resource: {
            type: "Marketplace::Book",
            id: book.id,
            attributes: {
              storeId: book.storeId,
              amountMinor: book.amountMinor,
              currency: book.currency,
              version: book.version,
            },
          },
          context: { buyerId: actor.id },
        });
        const id = randomUUID();
        const orderId = `order_${id}`;
        const refundId = `refund_${id}`;
        const createdAt = this.now();
        this.store.db
          .prepare(`
        INSERT INTO orders (
          id, buyerActorId, storeId, itemSummary, amountMinor, currency,
          paymentState, fulfillmentState, version, bookId, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, 'paid', 'fulfilled', 1, ?, ?)
      `)
          .run(
            orderId,
            actor.id,
            book.storeId,
            book.title,
            book.amountMinor,
            book.currency,
            book.id,
            createdAt,
          );
        this.store.db
          .prepare(`
        INSERT INTO refunds (id, orderId, state, version, updatedAt)
        VALUES (?, ?, 'eligible', 0, ?)
      `)
          .run(refundId, orderId, createdAt);
        this.store.db
          .prepare(`
        INSERT INTO support_assignments (
          id, actorId, refundId, currency, limitMinor, expiresAt, status, version
        ) VALUES (?, 'diego', ?, ?, 20000, ?, 'active', 1)
      `)
          .run(
            `support_${id}`,
            refundId,
            book.currency,
            createdAt + 86_400_000,
          );
        this.store.db
          .prepare(`
        INSERT INTO fraud_assignments (id, actorId, refundId, status, version)
        VALUES (?, 'nia', ?, 'active', 1)
      `)
          .run(`fraud_${id}`, refundId);
        this.store.db
          .prepare(`
        INSERT INTO risk_signals (refundId, code, version)
        VALUES (?, 'standard-review', 1)
      `)
          .run(refundId);
        return { order: requiredOrder(this.store, orderId) };
      })
      .immediate();
  }

  refunds(session: Session, requestId: string) {
    const actor = this.store.actor(session.actorId);
    this.authorizeCollection(
      "refund.list",
      actor,
      "RefundCase::queue",
      requestId,
    );
    return { refunds: this.store.refunds() };
  }

  view(session: Session, caseId: string, intent: unknown, requestId: string) {
    if (!isProjection(intent))
      throw new AppError(400, "INVALID_VIEW", "Choose a valid case view.");
    const actor = this.store.actor(session.actorId);
    const refund = requiredRefund(this.store, caseId);
    this.gateway.authorize({
      capability: "refund.case.view",
      actor,
      requestId,
      hideDenial: true,
      resource: refundResource(refund),
      context: {
        projectionIntent: intent,
        buyerMatch: actor.id === refund.buyerId,
        sellerMatch: actor.id === refund.sellerId,
        supportCaseMatch:
          this.store.support(actor.id, refund.id)?.refundId === refund.id,
        fraudCaseMatch:
          this.store.fraud(actor.id, refund.id)?.refundId === refund.id,
      },
    });
    return {
      refund: project(
        intent,
        refund,
        this.store.supportForCase(refund.id),
        this.store.fraudForCase(refund.id),
      ),
    };
  }

  requestRefund(
    session: Session,
    caseId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = object(input, ["reasonCategory", "reason", "expectedVersion"]);
    if (
      !isReason(body.reasonCategory) ||
      !validVersion(body.expectedVersion) ||
      !validReason(body.reason)
    )
      throw new AppError(400, "INVALID_INPUT", "Refund request is invalid.");
    const reason =
      typeof body.reason === "string" ? body.reason.trim() || null : null;
    return this.store.db
      .transaction(() => {
        const actor = this.store.actor(session.actorId);
        const refund = requiredRefund(this.store, caseId);
        expectTransition(refund, "eligible", body.expectedVersion as number);
        this.gateway.authorize({
          capability: "refund.request",
          actor,
          requestId,
          resource: refundResource(refund),
          context: {
            buyerMatch: actor.id === refund.buyerId,
            reasonCategory: body.reasonCategory,
          },
        });
        const now = this.now();
        const updated = this.store.db
          .prepare(`
        UPDATE refunds SET state='requested', version=version+1,
          reasonCategory=?, reason=?, requestedBy=?, requestedAt=?, updatedAt=?
        WHERE id=? AND state='eligible' AND version=?
      `)
          .run(
            body.reasonCategory,
            reason,
            actor.id,
            now,
            now,
            refund.id,
            refund.version,
          );
        if (updated.changes !== 1) throw conflict();
        return receipt(requiredRefund(this.store, caseId));
      })
      .immediate();
  }

  approve(session: Session, caseId: string, input: unknown, requestId: string) {
    const body = object(input, ["expectedVersion"]);
    if (!validVersion(body.expectedVersion))
      throw new AppError(400, "INVALID_INPUT", "Current version is required.");
    return this.store.db
      .transaction(() => {
        const actor = this.store.actor(session.actorId);
        const refund = requiredRefund(this.store, caseId);
        expectTransition(refund, "requested", body.expectedVersion as number);
        const assignment = this.store.support(actor.id, refund.id);
        const facts = supportFacts(refund, assignment, this.now());
        this.gateway.authorize({
          capability: "refund.approve",
          actor,
          requestId,
          resource: refundResource(refund),
          context: {
            requesterDifferent: refund.requestedBy !== actor.id,
            ...facts,
            amountMinor: refund.amountMinor,
            currency: refund.currency,
            assignmentLimitMinor: assignment?.limitMinor ?? null,
          },
        });
        const fresh = requiredRefund(this.store, caseId);
        if (
          fresh.version !== refund.version ||
          fresh.orderVersion !== refund.orderVersion ||
          this.store.support(actor.id, refund.id)?.version !==
            assignment?.version
        )
          throw conflict();
        const now = this.now();
        const changed = this.store.db
          .prepare(`
        UPDATE refunds SET state='approved-awaiting-fraud', version=version+1,
          approvedBy=?, approvedAt=?, supportAssignmentVersion=?, updatedAt=?
        WHERE id=? AND state='requested' AND version=?
      `)
          .run(
            actor.id,
            now,
            assignment?.version ?? 0,
            now,
            refund.id,
            refund.version,
          );
        if (changed.changes !== 1) throw conflict();
        return receipt(requiredRefund(this.store, caseId));
      })
      .immediate();
  }

  review(session: Session, caseId: string, input: unknown, requestId: string) {
    const body = object(input, ["outcome", "expectedVersion"]);
    if (
      (body.outcome !== "clear" && body.outcome !== "block") ||
      !validVersion(body.expectedVersion)
    )
      throw new AppError(
        400,
        "INVALID_INPUT",
        "Review outcome and version are required.",
      );
    const outcome = body.outcome;
    return this.store.db
      .transaction(() => {
        const actor = this.store.actor(session.actorId);
        const refund = requiredRefund(this.store, caseId);
        const assignment = this.store.fraud(actor.id, refund.id);
        const support = refund.approvedBy
          ? this.store.support(refund.approvedBy, refund.id)
          : undefined;
        if (outcome === "clear" && refund.state === "completed") {
          const effect = this.store.effect(refund.id);
          if (!effect) throw new Error("Completed refund has no effect");
          if (body.expectedVersion !== effect.refundVersion) throw conflict();
          this.authorizeReview(
            actor,
            refund,
            assignment,
            support,
            requestId,
            outcome,
            true,
          );
          return {
            ...receipt(refund),
            effect: { id: effect.id, synthetic: true as const },
          };
        }
        expectTransition(
          refund,
          "approved-awaiting-fraud",
          body.expectedVersion as number,
        );
        this.authorizeReview(
          actor,
          refund,
          assignment,
          support,
          requestId,
          outcome,
          false,
        );
        const fresh = requiredRefund(this.store, caseId);
        const freshAssignment = this.store.fraud(actor.id, refund.id);
        const freshSupport = fresh.approvedBy
          ? this.store.support(fresh.approvedBy, refund.id)
          : undefined;
        if (
          fresh.version !== refund.version ||
          fresh.orderVersion !== refund.orderVersion ||
          fresh.riskVersion !== refund.riskVersion ||
          fresh.supportAssignmentVersion !== refund.supportAssignmentVersion ||
          freshAssignment?.version !== assignment?.version ||
          freshSupport?.version !== support?.version
        )
          throw conflict();
        const reviewedAt = this.now();
        if (outcome === "block") {
          const changed = this.store.db
            .prepare(`
          UPDATE refunds SET state='fraud-blocked', version=version+1,
            fraudOutcome='block', fraudReviewedBy=?, fraudReviewedAt=?, updatedAt=?
          WHERE id=? AND state='approved-awaiting-fraud' AND version=?
        `)
            .run(actor.id, reviewedAt, reviewedAt, refund.id, refund.version);
          if (changed.changes !== 1) throw conflict();
          return receipt(requiredRefund(this.store, caseId));
        }
        const effectId = `effect_${randomUUID()}`;
        this.store.db
          .prepare(`
        INSERT INTO refund_effects (
          id, refundId, requestId, reviewerId, amountMinor, currency,
          refundVersion, supportAssignmentVersion, fraudAssignmentVersion,
          createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
          .run(
            effectId,
            refund.id,
            requestId,
            actor.id,
            refund.amountMinor,
            refund.currency,
            refund.version,
            support?.version ?? 0,
            assignment?.version ?? 0,
            reviewedAt,
          );
        const changed = this.store.db
          .prepare(`
        UPDATE refunds SET state='completed', version=version+1,
          fraudOutcome='clear', fraudReviewedBy=?, fraudReviewedAt=?, updatedAt=?
        WHERE id=? AND state='approved-awaiting-fraud' AND version=?
      `)
          .run(actor.id, reviewedAt, reviewedAt, refund.id, refund.version);
        if (changed.changes !== 1) throw conflict();
        return {
          ...receipt(requiredRefund(this.store, caseId)),
          effect: { id: effectId, synthetic: true as const },
        };
      })
      .immediate();
  }

  private authorizeCollection(
    capability: Capability,
    actor: Actor,
    id: string,
    requestId: string,
  ) {
    this.gateway.authorize({
      capability,
      actor,
      requestId,
      resource: { type: "Marketplace::Collection", id, attributes: {} },
    });
  }

  private authorizeReview(
    actor: Actor,
    refund: RefundSnapshot,
    assignment: FraudAssignment | undefined,
    support: SupportAssignment | undefined,
    requestId: string,
    outcome: "clear" | "block",
    repeated: boolean,
  ) {
    const assigned = assignment?.status === "active";
    return this.gateway.authorize({
      capability: "fraud.review",
      actor,
      requestId,
      resource: refundResource(refund),
      context: {
        outcome,
        repeated,
        assigned,
        riskCode: refund.riskCode,
        riskVersion: refund.riskVersion,
        supportAssignmentCurrent:
          support?.status === "active" && support.expiresAt > this.now(),
        proposedEffect:
          outcome === "clear"
            ? { amountMinor: refund.amountMinor, currency: refund.currency }
            : null,
      },
    });
  }
}

function refundResource(refund: RefundSnapshot) {
  return {
    type: "Marketplace::RefundCase",
    id: refund.id,
    attributes: {
      state: refund.state,
      version: refund.version,
      orderVersion: refund.orderVersion,
    },
  };
}
function expectTransition(
  refund: RefundSnapshot,
  state: RefundSnapshot["state"],
  version: number,
) {
  if (refund.state !== state)
    throw new AppError(409, "INVALID_TRANSITION", "Action no longer applies.");
  if (refund.version !== version) throw conflict();
}
function requiredOrder(store: Store, id: string) {
  const order = store.order(id);
  if (!order) throw new Error("Order commit failed");
  return order;
}
function requiredRefund(store: Store, id: string) {
  const refund = store.refund(id);
  if (!refund) throw unavailableCase();
  return refund;
}
function receipt(refund: RefundSnapshot) {
  return { caseId: refund.id, state: refund.state, version: refund.version };
}
function unavailableCase() {
  return new AppError(404, "CASE_UNAVAILABLE", "Refund case is unavailable.");
}
function authorizationError() {
  return new AppError(503, "AUTHORIZATION_ERROR", "Authorization failed.");
}
function validDecision(value: unknown): value is AuthorizationDecision {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    (result.decision === "ALLOW" || result.decision === "DENY") &&
    result.mode === "permissive"
  );
}
function isProjection(value: unknown): value is ProjectionIntent {
  return projectionIntents.some((projection) => projection === value);
}
function isReason(value: unknown): value is ReasonCategory {
  return reasonCategories.some((category) => category === value);
}
function validVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function validReason(value: unknown) {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.trim().length <= 240 &&
      !hasControlCharacter(value, true))
  );
}
function hasControlCharacter(value: string, allowFormatting = false) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code < 32 && !(allowFormatting && [9, 10, 13].includes(code))) ||
      code === 127
    );
  });
}
function supportFacts(
  refund: RefundSnapshot,
  assignment: SupportAssignment | undefined,
  now: number,
) {
  return {
    assignmentCaseMatch: assignment?.refundId === refund.id,
    assignmentCurrent:
      assignment?.status === "active" && assignment.expiresAt > now,
    currencyMatch: assignment?.currency === refund.currency,
    withinLimit: (assignment?.limitMinor ?? -1) >= refund.amountMinor,
  };
}
function common(refund: RefundSnapshot) {
  return {
    caseId: refund.id,
    orderId: refund.orderId,
    bookTitle: refund.bookTitle,
    buyerDisplayName: refund.buyerName,
    sellerDisplayName: refund.sellerName,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    state: refund.state,
    version: refund.version,
    updatedAt: refund.updatedAt,
  };
}
function project(
  intent: ProjectionIntent,
  refund: RefundSnapshot,
  support: SupportAssignment | undefined,
  fraud: FraudAssignment | undefined,
): RefundProjection {
  const base = {
    ...common(refund),
    nextActorDisplayName: nextActor(refund, support, fraud),
  };
  if (intent === "buyer")
    return {
      ...base,
      view: intent,
      expectedBuyer: refund.buyerName,
      reasonCategory: refund.reasonCategory,
      reason: refund.reason,
      requestedBy: refund.requestedByName,
      requestedAt: refund.requestedAt,
    };
  if (intent === "seller")
    return {
      ...base,
      view: intent,
      expectedSeller: refund.sellerName,
      fulfillmentState: refund.fulfillmentState,
      reasonCategory: refund.reasonCategory,
      requestedAt: refund.requestedAt,
    } satisfies SellerProjection;
  if (intent === "support")
    return {
      ...base,
      view: intent,
      expectedApprover: support?.actorName ?? null,
      requestedBy: refund.requestedByName,
      assignment: {
        caseId: support?.refundId ?? null,
        expiresAt: support?.expiresAt ?? null,
        limitMinor: support?.limitMinor ?? null,
        currency: support?.currency ?? null,
        status: support?.status ?? "missing",
      },
      approvedBy: refund.approvedByName,
      approvedAt: refund.approvedAt,
      fraudStatus:
        refund.fraudOutcome === "clear"
          ? "cleared"
          : refund.fraudOutcome === "block"
            ? "blocked"
            : "pending",
    } satisfies SupportProjection;
  return {
    ...base,
    view: intent,
    expectedReviewer: fraud?.actorName ?? null,
    riskLabel: "Standard payment review",
    riskCode: refund.riskCode,
    supportApproval: { actor: refund.approvedByName, time: refund.approvedAt },
    fraudAssignment: {
      reviewer: fraud?.actorName ?? null,
      status: fraud?.status ?? "missing",
    },
    review: {
      outcome: refund.fraudOutcome,
      actor: refund.fraudReviewedByName,
      time: refund.fraudReviewedAt,
    },
    effect:
      refund.effectId && refund.effectCreatedAt
        ? {
            id: refund.effectId,
            createdAt: refund.effectCreatedAt,
            synthetic: true,
          }
        : null,
  } satisfies FraudProjection;
}

function nextActor(
  refund: RefundSnapshot,
  support: SupportAssignment | undefined,
  fraud: FraudAssignment | undefined,
) {
  if (refund.state === "eligible") return refund.buyerName;
  if (refund.state === "requested") return support?.actorName ?? null;
  if (refund.state === "approved-awaiting-fraud")
    return fraud?.actorName ?? null;
  return null;
}
