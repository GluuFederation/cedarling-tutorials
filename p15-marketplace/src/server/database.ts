import Database from "better-sqlite3";
import type {
  ActorId,
  ActorRole,
  Book,
  OrderSummary,
  ReasonCategory,
  RefundState,
  RefundSummary,
} from "../shared/protocol.ts";
import { accounts } from "../shared/protocol.ts";
import { assertSqlitePath } from "./files.ts";
import { AppError, sessionExpired } from "./security.ts";

export type Actor = {
  id: ActorId;
  name: string;
  role: ActorRole;
  version: number;
};

type RefundRow = {
  id: string;
  orderId: string;
  state: RefundState;
  version: number;
  reasonCategory: ReasonCategory | null;
  reason: string | null;
  requestedBy: ActorId | null;
  requestedAt: number | null;
  approvedBy: ActorId | null;
  approvedAt: number | null;
  supportAssignmentVersion: number | null;
  fraudOutcome: "clear" | "block" | null;
  fraudReviewedBy: ActorId | null;
  fraudReviewedAt: number | null;
  updatedAt: number;
};

export type RefundSnapshot = RefundRow & {
  buyerId: ActorId;
  buyerName: string;
  sellerId: ActorId | null;
  sellerName: string;
  bookTitle: string;
  amountMinor: number;
  currency: string;
  fulfillmentState: "fulfilled";
  orderVersion: number;
  riskCode: string;
  riskVersion: number;
  requestedByName: string | null;
  approvedByName: string | null;
  fraudReviewedByName: string | null;
  effectId: string | null;
  effectCreatedAt: number | null;
};

export type SupportAssignment = {
  id: string;
  actorId: ActorId;
  refundId: string;
  currency: string;
  limitMinor: number;
  expiresAt: number;
  status: "active" | "revoked";
  version: number;
  actorName: string;
};

export type FraudAssignment = {
  id: string;
  actorId: ActorId;
  refundId: string;
  status: "active" | "revoked";
  version: number;
  actorName: string;
};

type RefundEffect = {
  id: string;
  refundId: string;
  requestId: string;
  reviewerId: ActorId;
  amountMinor: number;
  currency: string;
  refundVersion: number;
  supportAssignmentVersion: number;
  fraudAssignmentVersion: number;
  createdAt: number;
};

export type Session = {
  hash: string;
  actorId: ActorId;
  csrf: string;
  encryptedTokens: string;
  expiresAt: number;
};

export type LoginTransaction = {
  state: string;
  nonce: string;
  verifier: string;
};

const seedTime = 1_789_430_400_000;
const farFuture = 4_102_444_800_000;

const migrations = [
  `
  CREATE TABLE actors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('buyer','seller','support','fraud')),
    version INTEGER NOT NULL CHECK(version >= 0)
  );
  CREATE TABLE stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sellerActorId TEXT REFERENCES actors(id)
  );
  CREATE TABLE books (
    id TEXT PRIMARY KEY,
    storeId TEXT NOT NULL REFERENCES stores(id),
    title TEXT NOT NULL,
    authors TEXT NOT NULL,
    summary TEXT NOT NULL,
    coverKey TEXT NOT NULL,
    amountMinor INTEGER NOT NULL CHECK(amountMinor > 0),
    currency TEXT NOT NULL CHECK(length(currency) = 3),
    version INTEGER NOT NULL CHECK(version >= 0)
  );
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    buyerActorId TEXT NOT NULL REFERENCES actors(id),
    storeId TEXT NOT NULL REFERENCES stores(id),
    itemSummary TEXT NOT NULL,
    amountMinor INTEGER NOT NULL CHECK(amountMinor > 0),
    currency TEXT NOT NULL CHECK(length(currency) = 3),
    paymentState TEXT NOT NULL CHECK(paymentState = 'paid'),
    fulfillmentState TEXT NOT NULL CHECK(fulfillmentState = 'fulfilled'),
    version INTEGER NOT NULL CHECK(version >= 0),
    bookId TEXT NOT NULL REFERENCES books(id),
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE refunds (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL UNIQUE REFERENCES orders(id),
    state TEXT NOT NULL CHECK(state IN ('eligible','requested','approved-awaiting-fraud','completed','fraud-blocked')),
    version INTEGER NOT NULL CHECK(version >= 0),
    reasonCategory TEXT CHECK(reasonCategory IN ('damaged','not-received','item-not-as-described')),
    reason TEXT CHECK(reason IS NULL OR length(reason) <= 240),
    requestedBy TEXT REFERENCES actors(id),
    requestedAt INTEGER,
    approvedBy TEXT REFERENCES actors(id),
    approvedAt INTEGER,
    supportAssignmentVersion INTEGER,
    fraudOutcome TEXT CHECK(fraudOutcome IN ('clear','block')),
    fraudReviewedBy TEXT REFERENCES actors(id),
    fraudReviewedAt INTEGER,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE support_assignments (
    id TEXT PRIMARY KEY,
    actorId TEXT NOT NULL REFERENCES actors(id),
    refundId TEXT NOT NULL REFERENCES refunds(id),
    currency TEXT NOT NULL CHECK(length(currency) = 3),
    limitMinor INTEGER NOT NULL CHECK(limitMinor >= 0),
    expiresAt INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','revoked')),
    version INTEGER NOT NULL CHECK(version >= 0),
    UNIQUE(refundId)
  );
  CREATE TABLE fraud_assignments (
    id TEXT PRIMARY KEY,
    actorId TEXT NOT NULL REFERENCES actors(id),
    refundId TEXT NOT NULL REFERENCES refunds(id),
    status TEXT NOT NULL CHECK(status IN ('active','revoked')),
    version INTEGER NOT NULL CHECK(version >= 0),
    UNIQUE(refundId)
  );
  CREATE TABLE risk_signals (
    refundId TEXT PRIMARY KEY REFERENCES refunds(id),
    code TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version >= 0)
  );
  CREATE TABLE refund_effects (
    id TEXT PRIMARY KEY,
    refundId TEXT NOT NULL UNIQUE REFERENCES refunds(id),
    requestId TEXT NOT NULL,
    reviewerId TEXT NOT NULL REFERENCES actors(id),
    amountMinor INTEGER NOT NULL CHECK(amountMinor > 0),
    currency TEXT NOT NULL CHECK(length(currency) = 3),
    refundVersion INTEGER NOT NULL,
    supportAssignmentVersion INTEGER NOT NULL,
    fraudAssignmentVersion INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    actorId TEXT NOT NULL REFERENCES actors(id),
    csrf TEXT NOT NULL,
    encryptedTokens TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  );
  CREATE TABLE login_transactions (
    hash TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  );
  CREATE INDEX orders_created_at ON orders(createdAt DESC);
  CREATE INDEX refunds_updated_at ON refunds(updatedAt DESC);
  `,
] as const;

type SeedRefund = {
  suffix: string;
  bookId: string;
  buyerId: ActorId;
  state: RefundState;
  createdAt: number;
  reason?: string;
  requestedBy?: ActorId;
  supportLimit?: number;
  approved?: boolean;
  reviewed?: "clear" | "block";
};

const seedRefunds: SeedRefund[] = [
  {
    suffix: "bao-001",
    bookId: "book-perimeter",
    buyerId: "bao",
    state: "eligible",
    createdAt: seedTime + 9_000,
    supportLimit: 20_000,
  },
  {
    suffix: "sela-001",
    bookId: "book-oauth-action",
    buyerId: "sela",
    state: "eligible",
    createdAt: seedTime + 8_000,
    supportLimit: 20_000,
  },
  {
    suffix: "nia-001",
    bookId: "book-oauth-simplified",
    buyerId: "nia",
    state: "eligible",
    createdAt: seedTime + 7_000,
    supportLimit: 20_000,
  },
  {
    suffix: "requested-001",
    bookId: "book-modern-identity",
    buyerId: "bao",
    state: "requested",
    createdAt: seedTime + 6_000,
    reason: "The package did not arrive.",
    requestedBy: "bao",
    supportLimit: 20_000,
  },
  {
    suffix: "scope-gap-001",
    bookId: "book-api-security",
    buyerId: "bao",
    state: "requested",
    createdAt: seedTime + 5_000,
    reason: "Requested by another actor.",
    requestedBy: "nia",
  },
  {
    suffix: "limit-gap-001",
    bookId: "book-perimeter",
    buyerId: "sela",
    state: "requested",
    createdAt: seedTime + 4_000,
    reason: "Refund amount exceeds the approval limit.",
    requestedBy: "sela",
    supportLimit: 4_000,
  },
  {
    suffix: "approved-001",
    bookId: "book-oauth-action",
    buyerId: "nia",
    state: "approved-awaiting-fraud",
    createdAt: seedTime + 3_000,
    reason: "Cover arrived damaged.",
    requestedBy: "nia",
    supportLimit: 20_000,
    approved: true,
  },
  {
    suffix: "completed-001",
    bookId: "book-modern-identity",
    buyerId: "bao",
    state: "completed",
    createdAt: seedTime + 2_000,
    reason: "The package did not arrive.",
    requestedBy: "bao",
    supportLimit: 20_000,
    approved: true,
    reviewed: "clear",
  },
  {
    suffix: "blocked-001",
    bookId: "book-api-security",
    buyerId: "sela",
    state: "fraud-blocked",
    createdAt: seedTime + 1_000,
    reason: "Item was not as described.",
    requestedBy: "sela",
    supportLimit: 20_000,
    approved: true,
    reviewed: "block",
  },
];

export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") assertSqlitePath(path);
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 3000");
    this.migrate();
    this.seed();
  }

  private migrate() {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      version > migrations.length
    )
      throw new Error("Unsupported database schema");
    this.db.transaction(() => {
      for (let index = version; index < migrations.length; index++) {
        this.db.exec(migrations[index] ?? "");
        this.db.pragma(`user_version = ${index + 1}`);
      }
    })();
  }

  private seed() {
    this.db.transaction(() => {
      const actor = this.db.prepare(
        `INSERT OR IGNORE INTO actors (id, name, role, version) VALUES (?, ?, ?, 1)`,
      );
      for (const value of accounts) actor.run(value.id, value.name, value.role);

      const store = this.db.prepare(
        `INSERT OR IGNORE INTO stores (id, name, sellerActorId) VALUES (?, ?, ?)`,
      );
      store.run("store-sela", "Sela Books", "sela");
      store.run("store-partner", "Partner Books", null);

      const book = this.db.prepare(`
        INSERT OR IGNORE INTO books (
          id, storeId, title, authors, summary, coverKey, amountMinor, currency, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', 1)
      `);
      book.run(
        "book-perimeter",
        "store-sela",
        "Securing the Perimeter",
        "Michael Schwartz and Maciej Machulak",
        "A practical guide to building an identity and access management platform with open standards and open source software.",
        "securing-perimeter",
        5_499,
      );
      book.run(
        "book-oauth-action",
        "store-sela",
        "OAuth 2 in Action",
        "Justin Richer and Antonio Sanso",
        "A hands-on tour of OAuth clients, authorization servers, protected APIs, tokens, and OpenID Connect.",
        "oauth-in-action",
        4_999,
      );
      book.run(
        "book-oauth-simplified",
        "store-sela",
        "OAuth 2.0 Simplified",
        "Aaron Parecki",
        "An approachable guide to the OAuth framework and the practical choices behind secure API access.",
        "oauth-simplified",
        2_999,
      );
      book.run(
        "book-modern-identity",
        "store-sela",
        "Solving Identity Management in Modern Applications",
        "Yvonne Wilson and Abhishek Hingnikar",
        "Identity lifecycle, authentication, authorization, OAuth, OpenID Connect, and SAML for modern applications.",
        "modern-identity",
        3_999,
      );
      book.run(
        "book-api-security",
        "store-partner",
        "Advanced API Security: OAuth 2.0 and Beyond",
        "Prabath Siriwardena",
        "A focused reference for protecting enterprise APIs with OAuth, OpenID Connect, JOSE, and related standards.",
        "advanced-api-security",
        4_499,
      );

      for (const fixture of seedRefunds) this.seedCase(fixture);
    })();
  }

  private seedCase(fixture: SeedRefund) {
    const book = this.book(fixture.bookId);
    if (!book) throw new Error(`Missing seed book ${fixture.bookId}`);
    const orderId = `order-${fixture.suffix}`;
    const refundId = `refund-${fixture.suffix}`;
    this.db
      .prepare(`
      INSERT OR IGNORE INTO orders (
        id, buyerActorId, storeId, itemSummary, amountMinor, currency,
        paymentState, fulfillmentState, version, bookId, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, 'paid', 'fulfilled', 1, ?, ?)
    `)
      .run(
        orderId,
        fixture.buyerId,
        book.storeId,
        book.title,
        book.amountMinor,
        book.currency,
        book.id,
        fixture.createdAt,
      );

    const requested = fixture.state !== "eligible";
    const approved = fixture.approved === true;
    const reviewed = fixture.reviewed;
    const version = reviewed ? 3 : approved ? 2 : requested ? 1 : 0;
    const requestedAt = requested ? fixture.createdAt + 60_000 : null;
    const approvedAt = approved ? fixture.createdAt + 120_000 : null;
    const reviewedAt = reviewed ? fixture.createdAt + 180_000 : null;
    const updatedAt =
      reviewedAt ?? approvedAt ?? requestedAt ?? fixture.createdAt;
    this.db
      .prepare(`
      INSERT OR IGNORE INTO refunds (
        id, orderId, state, version, reasonCategory, reason, requestedBy, requestedAt,
        approvedBy, approvedAt, supportAssignmentVersion, fraudOutcome,
        fraudReviewedBy, fraudReviewedAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        refundId,
        orderId,
        fixture.state,
        version,
        requested ? "damaged" : null,
        fixture.reason ?? null,
        fixture.requestedBy ?? null,
        requestedAt,
        approved ? "diego" : null,
        approvedAt,
        approved ? 1 : null,
        reviewed ?? null,
        reviewed ? "nia" : null,
        reviewedAt,
        updatedAt,
      );

    if (fixture.supportLimit !== undefined) {
      this.db
        .prepare(`
        INSERT OR IGNORE INTO support_assignments (
          id, actorId, refundId, currency, limitMinor, expiresAt, status, version
        ) VALUES (?, 'diego', ?, 'USD', ?, ?, 'active', 1)
      `)
        .run(
          `support-${fixture.suffix}`,
          refundId,
          fixture.supportLimit,
          farFuture,
        );
    }
    this.db
      .prepare(`
      INSERT OR IGNORE INTO fraud_assignments (
        id, actorId, refundId, status, version
      ) VALUES (?, 'nia', ?, 'active', 1)
    `)
      .run(`fraud-${fixture.suffix}`, refundId);
    this.db
      .prepare(`
      INSERT OR IGNORE INTO risk_signals (refundId, code, version)
      VALUES (?, 'standard-review', 1)
    `)
      .run(refundId);

    if (reviewed === "clear") {
      this.db
        .prepare(`
        INSERT OR IGNORE INTO refund_effects (
          id, refundId, requestId, reviewerId, amountMinor, currency,
          refundVersion, supportAssignmentVersion, fraudAssignmentVersion,
          createdAt
        ) VALUES (?, ?, 'seed_completed', 'nia', ?, ?, 2, 1, 1, ?)
      `)
        .run(
          `effect-${fixture.suffix}`,
          refundId,
          book.amountMinor,
          book.currency,
          reviewedAt,
        );
    }
  }

  actor(id: string): Actor {
    const value = this.db
      .prepare<[string], Actor>("SELECT * FROM actors WHERE id = ?")
      .get(id);
    if (!value) throw sessionExpired();
    return value;
  }

  books(): Book[] {
    return this.db
      .prepare<[], Book>(`
      SELECT b.*, s.name sellerDisplayName
      FROM books b JOIN stores s ON s.id = b.storeId
      ORDER BY b.rowid
    `)
      .all();
  }

  book(id: string): Book | undefined {
    return this.db
      .prepare<[string], Book>(`
      SELECT b.*, s.name sellerDisplayName
      FROM books b JOIN stores s ON s.id = b.storeId
      WHERE b.id = ?
    `)
      .get(id);
  }

  orders(): OrderSummary[] {
    return this.db
      .prepare<
        [],
        {
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
          refundId: string;
          refundState: RefundState;
          refundVersion: number;
        }
      >(`
      SELECT o.id, o.bookId, o.itemSummary bookTitle, o.buyerActorId buyerId,
        buyer.name buyerDisplayName, s.name sellerDisplayName, o.amountMinor,
        o.currency, o.paymentState, o.fulfillmentState, o.createdAt, o.version,
        r.id refundId, r.state refundState, r.version refundVersion
      FROM orders o
      JOIN actors buyer ON buyer.id = o.buyerActorId
      JOIN stores s ON s.id = o.storeId
      JOIN refunds r ON r.orderId = o.id
      ORDER BY o.createdAt DESC, o.id
    `)
      .all()
      .map(({ refundId, refundState, refundVersion, ...order }) => ({
        ...order,
        refund: { id: refundId, state: refundState, version: refundVersion },
      }));
  }

  order(id: string): OrderSummary | undefined {
    return this.orders().find((order) => order.id === id);
  }

  refunds(): RefundSummary[] {
    return this.db
      .prepare<[], RefundSummary>(`
      SELECT r.id caseId, r.orderId, o.itemSummary bookTitle,
        buyer.name buyerDisplayName, s.name sellerDisplayName,
        o.amountMinor, o.currency, r.state, r.version, r.updatedAt
      FROM refunds r
      JOIN orders o ON o.id = r.orderId
      JOIN actors buyer ON buyer.id = o.buyerActorId
      JOIN stores s ON s.id = o.storeId
      ORDER BY r.updatedAt DESC, r.id
    `)
      .all();
  }

  refund(id: string): RefundSnapshot | undefined {
    return this.db
      .prepare<[string], RefundSnapshot>(`
      SELECT r.*, o.buyerActorId buyerId, buyer.name buyerName,
        s.sellerActorId sellerId, s.name sellerName, o.itemSummary bookTitle,
        o.amountMinor, o.currency, o.fulfillmentState, o.version orderVersion,
        risk.code riskCode, risk.version riskVersion,
        requester.name requestedByName, approver.name approvedByName,
        reviewer.name fraudReviewedByName, effect.id effectId,
        effect.createdAt effectCreatedAt
      FROM refunds r
      JOIN orders o ON o.id = r.orderId
      JOIN actors buyer ON buyer.id = o.buyerActorId
      JOIN stores s ON s.id = o.storeId
      JOIN risk_signals risk ON risk.refundId = r.id
      LEFT JOIN actors requester ON requester.id = r.requestedBy
      LEFT JOIN actors approver ON approver.id = r.approvedBy
      LEFT JOIN actors reviewer ON reviewer.id = r.fraudReviewedBy
      LEFT JOIN refund_effects effect ON effect.refundId = r.id
      WHERE r.id = ?
    `)
      .get(id);
  }

  support(actorId: ActorId, refundId: string): SupportAssignment | undefined {
    return this.db
      .prepare<[ActorId, string], SupportAssignment>(`
      SELECT assignment.*, actor.name actorName
      FROM support_assignments assignment
      JOIN actors actor ON actor.id = assignment.actorId
      WHERE assignment.actorId = ? AND assignment.refundId = ?
    `)
      .get(actorId, refundId);
  }

  supportForCase(refundId: string): SupportAssignment | undefined {
    return this.db
      .prepare<[string], SupportAssignment>(`
      SELECT assignment.*, actor.name actorName
      FROM support_assignments assignment
      JOIN actors actor ON actor.id = assignment.actorId
      WHERE assignment.refundId = ?
    `)
      .get(refundId);
  }

  fraud(actorId: ActorId, refundId: string): FraudAssignment | undefined {
    return this.db
      .prepare<[ActorId, string], FraudAssignment>(`
      SELECT assignment.*, actor.name actorName
      FROM fraud_assignments assignment
      JOIN actors actor ON actor.id = assignment.actorId
      WHERE assignment.actorId = ? AND assignment.refundId = ?
    `)
      .get(actorId, refundId);
  }

  fraudForCase(refundId: string): FraudAssignment | undefined {
    return this.db
      .prepare<[string], FraudAssignment>(`
      SELECT assignment.*, actor.name actorName
      FROM fraud_assignments assignment
      JOIN actors actor ON actor.id = assignment.actorId
      WHERE assignment.refundId = ?
    `)
      .get(refundId);
  }

  effect(refundId: string): RefundEffect | undefined {
    return this.db
      .prepare<[string], RefundEffect>(
        "SELECT * FROM refund_effects WHERE refundId = ?",
      )
      .get(refundId);
  }

  createSession(session: Session, now: number) {
    this.prune(now);
    const count = this.db
      .prepare<[], { count: number }>("SELECT count(*) count FROM sessions")
      .get()?.count;
    if ((count ?? 0) >= 100)
      throw new AppError(
        503,
        "CAPACITY",
        "Session capacity reached. Retry later.",
      );
    this.db
      .prepare(`
      INSERT INTO sessions (hash, actorId, csrf, encryptedTokens, expiresAt)
      VALUES (@hash, @actorId, @csrf, @encryptedTokens, @expiresAt)
    `)
      .run(session);
  }

  session(hash: string, now: number) {
    this.prune(now);
    return this.db
      .prepare<[string], Session>("SELECT * FROM sessions WHERE hash = ?")
      .get(hash);
  }

  deleteSession(hash: string) {
    this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(hash);
  }

  login(hash: string, now: number): LoginTransaction | undefined {
    this.prune(now);
    const row = this.db
      .prepare<[string], { payload: string }>(`
      DELETE FROM login_transactions WHERE hash = ? RETURNING payload
    `)
      .get(hash);
    return row ? (JSON.parse(row.payload) as LoginTransaction) : undefined;
  }

  saveLogin(hash: string, value: LoginTransaction, now: number) {
    this.prune(now);
    const count = this.db
      .prepare<[], { count: number }>(
        "SELECT count(*) count FROM login_transactions",
      )
      .get()?.count;
    if ((count ?? 0) >= 100)
      throw new AppError(
        503,
        "CAPACITY",
        "Login capacity reached. Retry later.",
      );
    this.db
      .prepare(`
      INSERT INTO login_transactions (hash, payload, expiresAt) VALUES (?, ?, ?)
    `)
      .run(hash, JSON.stringify(value), now + 300_000);
  }

  private prune(now: number) {
    this.db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(now);
    this.db
      .prepare("DELETE FROM login_transactions WHERE expiresAt <= ?")
      .run(now);
  }

  close() {
    this.db.close();
  }
}
