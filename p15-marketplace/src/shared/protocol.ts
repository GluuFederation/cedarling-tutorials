export const capabilities = {
  "catalog.list": { action: "Marketplace::ListCatalog" },
  "order.list": { action: "Marketplace::ListOrders" },
  "order.create": { action: "Marketplace::CreateOrder" },
  "refund.list": { action: "Marketplace::ListRefunds" },
  "refund.case.view": { action: "Marketplace::ViewRefundCase" },
  "refund.request": { action: "Marketplace::RequestRefund" },
  "refund.approve": { action: "Marketplace::ApproveRefund" },
  "fraud.review": { action: "Marketplace::ReviewFraud" },
} as const;

export type Capability = keyof typeof capabilities;
export const projectionIntents = [
  "buyer",
  "seller",
  "support",
  "fraud",
] as const;
export type ProjectionIntent = (typeof projectionIntents)[number];
export type ActorRole = ProjectionIntent;
export const reasonCategories = [
  "damaged",
  "not-received",
  "item-not-as-described",
] as const;
export type ReasonCategory = (typeof reasonCategories)[number];
export type BookCoverKey =
  | "securing-perimeter"
  | "oauth-in-action"
  | "oauth-simplified"
  | "modern-identity"
  | "advanced-api-security";
export type RefundState =
  | "eligible"
  | "requested"
  | "approved-awaiting-fraud"
  | "completed"
  | "fraud-blocked";

export const accounts = [
  { id: "bao", name: "Bao", task: "Buyer · owns seeded orders", role: "buyer" },
  {
    id: "sela",
    name: "Sela",
    task: "Seller · operates Sela Books",
    role: "seller",
  },
  {
    id: "diego",
    name: "Diego",
    task: "Support · approves assigned refunds",
    role: "support",
  },
  {
    id: "nia",
    name: "Nia",
    task: "Fraud · reviews approved refunds",
    role: "fraud",
  },
] as const satisfies readonly {
  id: string;
  name: string;
  task: string;
  role: ActorRole;
}[];
export type ActorId = (typeof accounts)[number]["id"];

export type SessionView = {
  user: { id: ActorId; name: string; role: ActorRole };
  csrfToken: string;
  expiresAt: number;
};

export type Book = {
  id: string;
  title: string;
  authors: string;
  summary: string;
  coverKey: BookCoverKey;
  storeId: string;
  sellerDisplayName: string;
  amountMinor: number;
  currency: string;
  version: number;
};

export type CatalogResult = { books: Book[]; requestId: string };

export type OrderSummary = {
  id: string;
  bookId: string;
  bookTitle: string;
  buyerId: ActorId;
  buyerDisplayName: string;
  sellerDisplayName: string;
  amountMinor: number;
  currency: string;
  paymentState: "paid";
  fulfillmentState: "fulfilled";
  createdAt: number;
  version: number;
  refund: { id: string; state: RefundState; version: number };
};

export type OrderListResult = { orders: OrderSummary[]; requestId: string };
export type OrderMutationResult = { order: OrderSummary; requestId: string };

export type RefundSummary = {
  caseId: string;
  orderId: string;
  bookTitle: string;
  buyerDisplayName: string;
  sellerDisplayName: string;
  amountMinor: number;
  currency: string;
  state: RefundState;
  version: number;
  updatedAt: number;
};

export type RefundListResult = { refunds: RefundSummary[]; requestId: string };

type CommonProjection = RefundSummary & {
  view: ProjectionIntent;
  nextActorDisplayName: string | null;
};
export type BuyerProjection = CommonProjection & {
  view: "buyer";
  expectedBuyer: string;
  reasonCategory: ReasonCategory | null;
  reason: string | null;
  requestedBy: string | null;
  requestedAt: number | null;
};
export type SellerProjection = CommonProjection & {
  view: "seller";
  expectedSeller: string;
  fulfillmentState: "fulfilled";
  reasonCategory: ReasonCategory | null;
  requestedAt: number | null;
};
export type SupportProjection = CommonProjection & {
  view: "support";
  expectedApprover: string | null;
  requestedBy: string | null;
  assignment: {
    caseId: string | null;
    expiresAt: number | null;
    limitMinor: number | null;
    currency: string | null;
    status: "active" | "revoked" | "missing";
  };
  approvedBy: string | null;
  approvedAt: number | null;
  fraudStatus: "pending" | "cleared" | "blocked";
};
export type FraudProjection = CommonProjection & {
  view: "fraud";
  expectedReviewer: string | null;
  riskLabel: string;
  riskCode: string;
  supportApproval: { actor: string | null; time: number | null };
  fraudAssignment: {
    reviewer: string | null;
    status: "active" | "revoked" | "missing";
  };
  review: {
    outcome: "clear" | "block" | null;
    actor: string | null;
    time: number | null;
  };
  effect: { id: string; createdAt: number; synthetic: true } | null;
};
export type RefundProjection =
  | BuyerProjection
  | SellerProjection
  | SupportProjection
  | FraudProjection;
export type RefundViewResult = {
  refund: RefundProjection;
  requestId: string;
};
export type RefundMutationResult = {
  caseId: string;
  state: RefundState;
  version: number;
  effect?: { id: string; synthetic: true };
  requestId: string;
};
