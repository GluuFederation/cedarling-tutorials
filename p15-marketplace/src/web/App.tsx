import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  accounts,
  type Book,
  type OrderSummary,
  type ProjectionIntent,
  projectionIntents,
  type ReasonCategory,
  type RefundProjection,
  type RefundSummary,
  reasonCategories,
  type SessionView,
} from "../shared/protocol.ts";
import {
  ApiError,
  createOrder,
  loadCatalog,
  loadOrders,
  loadRefund,
  loadRefunds,
  loadSession,
  mutateRefund,
} from "./api.ts";
import advancedApiSecurity from "./assets/books/advanced-api-security.webp";
import modernIdentity from "./assets/books/modern-identity.webp";
import oauthAction from "./assets/books/oauth-in-action.webp";
import oauthSimplified from "./assets/books/oauth-simplified.webp";
import perimeter from "./assets/books/securing-perimeter.webp";
import mark from "./assets/cedarling-mark.png";
import wordmark from "./assets/cedarling-wordmark-dark.webp";
import { ArrowRight } from "./icons.tsx";

type Tab = "store" | "orders" | "refunds";
type Navigation = {
  tab: Tab;
  orderId: string | null;
  refundId: string | null;
  section: ProjectionIntent;
};
const defaultNavigation: Navigation = {
  tab: "store",
  orderId: null,
  refundId: null,
  section: "buyer",
};
const covers = {
  "securing-perimeter": perimeter,
  "oauth-in-action": oauthAction,
  "oauth-simplified": oauthSimplified,
  "modern-identity": modernIdentity,
  "advanced-api-security": advancedApiSecurity,
} as const;
const errors: Record<string, string> = {
  BOOK_UNAVAILABLE: "This book is no longer available.",
  CASE_UNAVAILABLE: "This refund is unavailable.",
  NOT_ALLOWED: "This action is not allowed.",
  STALE_STATE: "The record changed. Reload and try again.",
  INVALID_TRANSITION: "This action no longer applies.",
  INVALID_INPUT: "Check the form and try again.",
  REQUEST_REJECTED: "Your session could not verify this request.",
  AUTHORIZATION_UNAVAILABLE: "Authorization is unavailable. Retry.",
  AUTHORIZATION_ERROR: "Authorization failed. Retry.",
};

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    minor / 100,
  );
const label = (value: string) => value.replaceAll("-", " ");
const date = (value: number | null) =>
  value ? new Date(value).toLocaleString() : "—";
const isProjection = (value: string | null): value is ProjectionIntent =>
  projectionIntents.some((intent) => intent === value);
function readNavigation(): Navigation {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const section = params.get("section");
  const tab: Tab =
    view === "orders" || view === "refunds" || view === "store"
      ? view
      : "store";
  return {
    tab,
    orderId: tab === "orders" ? params.get("order") : null,
    refundId: tab === "refunds" ? params.get("refund") : null,
    section: isProjection(section) ? section : "buyer",
  };
}
function writeNavigation(value: Navigation, mode: "push" | "replace") {
  const params = new URLSearchParams();
  if (value.tab !== "store") params.set("view", value.tab);
  if (value.tab === "orders" && value.orderId)
    params.set("order", value.orderId);
  if (value.tab === "refunds" && value.refundId) {
    params.set("refund", value.refundId);
    params.set("section", value.section);
  }
  const query = params.size ? `?${params}` : window.location.pathname;
  window.history[`${mode}State`]({}, "", query);
}

function IdentityChooser({ notice }: { notice: string }) {
  return (
    <section className="login-panel" aria-labelledby="login-title">
      <h2 id="login-title">Choose an identity</h2>
      <nav className="account-choices" aria-label="Tutorial identities">
        {accounts.map((account) => (
          <a
            href={`/auth/login?login_hint=${account.id}`}
            className="account-choice"
            key={account.id}
          >
            <span className="account-avatar" aria-hidden="true">
              {account.name[0]}
            </span>
            <span className="account-copy">
              <strong>{account.name}</strong>
              <small>{account.task}</small>
            </span>
            <ArrowRight />
          </a>
        ))}
      </nav>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function DetailRows({ refund }: { refund: RefundProjection }) {
  const rows: [string, string | number][] = [
    ["Order", refund.orderId],
    ["Buyer", refund.buyerDisplayName],
    ["Seller", refund.sellerDisplayName],
    ["Refund", money(refund.amountMinor, refund.currency)],
    ["State", label(refund.state)],
  ];
  if (refund.view === "buyer")
    rows.push(
      ["Expected buyer", refund.expectedBuyer],
      ["Requested by", refund.requestedBy ?? "—"],
      ["Reason", refund.reasonCategory ? label(refund.reasonCategory) : "—"],
      ["Details", refund.reason ?? "—"],
      ["Requested", date(refund.requestedAt)],
    );
  if (refund.view === "seller")
    rows.push(
      ["Expected seller", refund.expectedSeller],
      ["Fulfilment", refund.fulfillmentState],
      ["Reason", refund.reasonCategory ? label(refund.reasonCategory) : "—"],
    );
  if (refund.view === "support")
    rows.push(
      ["Expected approver", refund.expectedApprover ?? "—"],
      ["Requested by", refund.requestedBy ?? "—"],
      ["Assignment", refund.assignment.status],
      [
        "Approval limit",
        refund.assignment.limitMinor === null || !refund.assignment.currency
          ? "—"
          : money(refund.assignment.limitMinor, refund.assignment.currency),
      ],
      ["Approved by", refund.approvedBy ?? "—"],
      ["Fraud", refund.fraudStatus],
    );
  if (refund.view === "fraud")
    rows.push(
      ["Expected reviewer", refund.expectedReviewer ?? "—"],
      ["Risk", refund.riskLabel],
      ["Approved by", refund.supportApproval.actor ?? "—"],
      ["Assignment", refund.fraudAssignment.status],
      ["Outcome", refund.review.outcome ?? "pending"],
    );
  return (
    <dl className="detail-rows">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrderRows({ order }: { order: OrderSummary }) {
  const rows = [
    ["Buyer", order.buyerDisplayName],
    ["Seller", order.sellerDisplayName],
    ["Price", money(order.amountMinor, order.currency)],
    ["Payment", order.paymentState],
    ["Fulfilment", order.fulfillmentState],
    ["Placed", date(order.createdAt)],
    ["Refund", label(order.refund.state)],
  ];
  return (
    <dl className="detail-rows order-detail-rows">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExpectedActor({ name }: { name: string | null }) {
  return (
    <p>
      <strong>Expected actor: {name ?? "unassigned"}</strong> · permissive lets
      any signed-in actor try.
    </p>
  );
}

export function App() {
  const initialNavigation = useRef(readNavigation()).current;
  const [session, setSession] = useState<SessionView | null>(null);
  const [starting, setStarting] = useState(true);
  const [tab, setTab] = useState<Tab>(initialNavigation.tab);
  const [books, setBooks] = useState<Book[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [refunds, setRefunds] = useState<RefundSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(
    initialNavigation.orderId,
  );
  const [selectedRefund, setSelectedRefund] = useState<string | null>(
    initialNavigation.refundId,
  );
  const [section, setSection] = useState<ProjectionIntent>(
    initialNavigation.section,
  );
  const [detail, setDetail] = useState<RefundProjection | null>(null);
  const [reasonCategory, setReasonCategory] =
    useState<ReasonCategory>("damaged");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  const clearProtectedState = useCallback((message = "") => {
    run.current++;
    setSession(null);
    setTab("store");
    setBooks([]);
    setOrders([]);
    setRefunds([]);
    setSelectedOrder(null);
    setSelectedRefund(null);
    setSection("buyer");
    setDetail(null);
    setReasonCategory("damaged");
    setReason("");
    setBusy(false);
    setNotice(message);
    writeNavigation(defaultNavigation, "replace");
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        clearProtectedState("Session expired. Choose an identity again.");
        return;
      }
      setNotice(
        error instanceof ApiError
          ? `${errors[error.code] ?? "Request failed."} Reference: ${error.reference}`
          : "Application unavailable. Retry.",
      );
    },
    [clearProtectedState],
  );

  const loadView = useCallback(
    async (next: Navigation, mode: "push" | "replace" = "push") => {
      const ticket = ++run.current;
      setBusy(true);
      setNotice("");
      setDetail(null);
      setSelectedOrder(null);
      setSelectedRefund(null);
      try {
        let resolved = next;
        if (next.tab === "store") {
          const values = (await loadCatalog()).books;
          if (ticket !== run.current) return;
          setBooks(values);
        }
        if (next.tab === "orders") {
          const values = (await loadOrders()).orders;
          const orderId = values.some((order) => order.id === next.orderId)
            ? next.orderId
            : null;
          if (ticket !== run.current) return;
          setOrders(values);
          setSelectedOrder(orderId);
          resolved = { ...next, orderId };
        }
        if (next.tab === "refunds") {
          const values = (await loadRefunds()).refunds;
          const refundId = values.some(
            (refund) => refund.caseId === next.refundId,
          )
            ? next.refundId
            : null;
          const refund = refundId
            ? (await loadRefund(refundId, next.section)).refund
            : null;
          if (ticket !== run.current) return;
          setRefunds(values);
          setSelectedRefund(refundId);
          setDetail(refund);
          resolved = { ...next, refundId };
        }
        if (ticket !== run.current) return;
        setTab(next.tab);
        setSection(next.section);
        writeNavigation(resolved, mode);
      } catch (error) {
        if (ticket === run.current) fail(error);
      } finally {
        if (ticket === run.current) setBusy(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    const ticket = ++run.current;
    void loadSession()
      .then((value) => {
        if (ticket !== run.current) return;
        setSession(value);
        setStarting(false);
        if (value) void loadView(readNavigation(), "replace");
      })
      .catch((error) => {
        if (ticket === run.current) {
          setStarting(false);
          fail(error);
        }
      });
    return () => {
      run.current++;
    };
  }, [fail, loadView]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => clearProtectedState("Session expired. Choose an identity again."),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [clearProtectedState, session]);

  useEffect(() => {
    if (!session) return;
    const navigate = () => void loadView(readNavigation(), "replace");
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [loadView, session]);

  async function chooseRefund(caseId: string, nextSection = section) {
    const ticket = ++run.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await loadRefund(caseId, nextSection);
      if (ticket === run.current) {
        setSelectedRefund(caseId);
        setSelectedOrder(null);
        setSection(nextSection);
        setDetail(result.refund);
        writeNavigation(
          {
            tab: "refunds",
            orderId: null,
            refundId: caseId,
            section: nextSection,
          },
          "push",
        );
      }
    } catch (error) {
      if (ticket === run.current) fail(error);
    } finally {
      if (ticket === run.current) setBusy(false);
    }
  }

  function chooseOrder(orderId: string) {
    setSelectedOrder(orderId);
    setSelectedRefund(null);
    setDetail(null);
    writeNavigation(
      { tab: "orders", orderId, refundId: null, section },
      "push",
    );
  }

  async function buy(book: Book) {
    if (!session) return;
    const ticket = ++run.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await createOrder(
        book.id,
        book.version,
        session.csrfToken,
      );
      if (ticket !== run.current) return;
      setTab("orders");
      setOrders([result.order]);
      setSelectedOrder(result.order.id);
      setSelectedRefund(null);
      setDetail(null);
      writeNavigation(
        {
          tab: "orders",
          orderId: result.order.id,
          refundId: null,
          section: session.user.role,
        },
        "push",
      );
      setNotice(`“${result.order.bookTitle}” ordered successfully.`);
      try {
        const values = (await loadOrders()).orders;
        if (ticket === run.current) setOrders(values);
      } catch {
        // The committed order remains visible from the mutation response.
      }
    } catch (error) {
      if (ticket === run.current) fail(error);
    } finally {
      if (ticket === run.current) setBusy(false);
    }
  }

  async function act(
    path: "request" | "approval" | "fraud-review",
    body: object,
  ) {
    if (!session || !detail) return;
    const ticket = ++run.current;
    const caseId = detail.caseId;
    const projection = section;
    setBusy(true);
    setNotice("");
    try {
      const result = await mutateRefund(caseId, path, body, session.csrfToken);
      if (ticket !== run.current) return;
      const [nextRefunds, nextDetail] = await Promise.all([
        loadRefunds(),
        loadRefund(caseId, projection),
      ]);
      if (ticket !== run.current) return;
      setNotice(
        result.effect
          ? `Platform refund recorded once. Effect: ${result.effect.id}`
          : `Refund moved to ${label(result.state)}.`,
      );
      setRefunds(nextRefunds.refunds);
      setDetail(nextDetail.refund);
    } catch (error) {
      if (ticket === run.current) fail(error);
    } finally {
      if (ticket === run.current) setBusy(false);
    }
  }

  async function switchIdentity() {
    const current = session;
    clearProtectedState();
    const ticket = run.current;
    if (!current) return;
    try {
      await fetch("/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": current.csrfToken },
      });
    } catch {
      if (ticket === run.current)
        setNotice(
          "Sign-out did not finish. A new sign-in replaces this session.",
        );
    }
  }

  function requestRefund(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    void act("request", {
      reasonCategory,
      reason,
      expectedVersion: detail.version,
    });
  }

  const orderDetail = orders.find((order) => order.id === selectedOrder);

  return (
    <div className="app-shell">
      <header className="brand-rail">
        <picture className="brand-lockup">
          <source media="(max-width: 760px)" srcSet={mark} />
          <img src={wordmark} alt="Cedarling" />
        </picture>
        <div className="topbar-copy">
          <h1>
            P15 - Authorizing a Multi-Party Marketplace Refund with Cedarling
          </h1>
          <p>Follow one refund across buyer, seller, support, and fraud.</p>
        </div>
        {session ? (
          <details className="account-menu">
            <summary className="rail-identity" aria-label="Open account menu">
              <span className="identity-avatar" aria-hidden="true">
                {session.user.name[0]}
              </span>
              <strong>{session.user.name}</strong>
            </summary>
            <div className="account-menu-items">
              <button type="button" onClick={() => void switchIdentity()}>
                Change account
              </button>
              <button type="button" onClick={() => void switchIdentity()}>
                Sign out
              </button>
            </div>
          </details>
        ) : (
          <span />
        )}
      </header>
      <main className={session ? "workspace" : "landing"}>
        {starting ? (
          <p className="state">Loading…</p>
        ) : !session ? (
          <IdentityChooser notice={notice} />
        ) : (
          <>
            <nav className="tabs" aria-label="Marketplace">
              <button
                type="button"
                className={tab === "store" ? "active" : ""}
                onClick={() =>
                  void loadView(
                    { ...defaultNavigation, section: session.user.role },
                    "push",
                  )
                }
              >
                Store
              </button>
              <button
                type="button"
                className={tab === "orders" ? "active" : ""}
                onClick={() =>
                  void loadView(
                    {
                      ...defaultNavigation,
                      tab: "orders",
                      section: session.user.role,
                    },
                    "push",
                  )
                }
              >
                Orders
              </button>
              <button
                type="button"
                className={tab === "refunds" ? "active" : ""}
                onClick={() =>
                  void loadView(
                    {
                      ...defaultNavigation,
                      tab: "refunds",
                      section: session.user.role,
                    },
                    "push",
                  )
                }
              >
                Refunds
              </button>
            </nav>
            {tab === "store" && (
              <section className="catalog" aria-busy={busy}>
                <div className="section-heading">
                  <h2>Security bookshelf</h2>
                  <p>Choose one book. Checkout is simulated.</p>
                </div>
                <div className="book-grid">
                  {books.map((book) => (
                    <article className="book-card" key={book.id}>
                      <img src={covers[book.coverKey]} alt="" />
                      <div>
                        <h3>{book.title}</h3>
                        <p className="byline">{book.authors}</p>
                        <p>{book.summary}</p>
                        <footer>
                          <strong>
                            {money(book.amountMinor, book.currency)}
                          </strong>
                          <button
                            type="button"
                            className="primary"
                            disabled={busy}
                            onClick={() => void buy(book)}
                          >
                            Buy
                          </button>
                        </footer>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {tab === "orders" && (
              <section
                className={`queue-view ${selectedOrder ? "has-detail" : ""}`}
                aria-busy={busy}
              >
                <div className="queue">
                  <div className="section-heading">
                    <h2>Orders</h2>
                    <p>All fulfilled orders and their refund state.</p>
                  </div>
                  {orders.map((order) => (
                    <button
                      type="button"
                      className={`queue-row ${selectedOrder === order.id ? "selected" : ""}`}
                      aria-current={selectedOrder === order.id}
                      key={order.id}
                      onClick={() => chooseOrder(order.id)}
                    >
                      <div>
                        <strong>{order.bookTitle}</strong>
                        <small>
                          {order.buyerDisplayName} ·{" "}
                          {money(order.amountMinor, order.currency)}
                        </small>
                      </div>
                      <span className={`status ${order.refund.state}`}>
                        {label(order.refund.state)}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="detail">
                  {orderDetail ? (
                    <>
                      <button
                        type="button"
                        className="back"
                        onClick={() => {
                          setSelectedOrder(null);
                          writeNavigation(
                            {
                              tab: "orders",
                              orderId: null,
                              refundId: null,
                              section,
                            },
                            "push",
                          );
                        }}
                      >
                        ← Back to orders
                      </button>
                      <header className="detail-heading">
                        <div>
                          <small>Order detail</small>
                          <h2>{orderDetail.bookTitle}</h2>
                        </div>
                        <span className={`status ${orderDetail.refund.state}`}>
                          {label(orderDetail.refund.state)}
                        </span>
                      </header>
                      <OrderRows order={orderDetail} />
                      <div className="detail-action">
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void loadView(
                              {
                                tab: "refunds",
                                orderId: null,
                                refundId: orderDetail.refund.id,
                                section: session.user.role,
                              },
                              "push",
                            )
                          }
                        >
                          View refund
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty-detail">
                      <h2>Choose an order</h2>
                      <p>Review its purchase and current refund state.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {tab === "refunds" && (
              <section
                className={`queue-view ${selectedRefund ? "has-detail" : ""}`}
                aria-busy={busy}
              >
                <div className="queue">
                  <div className="section-heading">
                    <h2>Refunds</h2>
                    <p>Shared lifecycle queue · {refunds.length} cases</p>
                  </div>
                  {refunds.map((refund) => (
                    <button
                      type="button"
                      className={`queue-row ${selectedRefund === refund.caseId ? "selected" : ""}`}
                      aria-current={selectedRefund === refund.caseId}
                      key={refund.caseId}
                      onClick={() =>
                        void chooseRefund(refund.caseId, session.user.role)
                      }
                    >
                      <div>
                        <strong>{refund.bookTitle}</strong>
                        <small>
                          {refund.buyerDisplayName} ·{" "}
                          {money(refund.amountMinor, refund.currency)}
                        </small>
                      </div>
                      <span className={`status ${refund.state}`}>
                        {label(refund.state)}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="detail">
                  {detail ? (
                    <>
                      <button
                        type="button"
                        className="back"
                        onClick={() => {
                          setSelectedRefund(null);
                          setDetail(null);
                          writeNavigation(
                            {
                              tab: "refunds",
                              orderId: null,
                              refundId: null,
                              section,
                            },
                            "push",
                          );
                        }}
                      >
                        ← Back to refunds
                      </button>
                      <header className="detail-heading">
                        <div>
                          <small>Refund case</small>
                          <h2>{detail.bookTitle}</h2>
                        </div>
                        <span className={`status ${detail.state}`}>
                          {label(detail.state)}
                        </span>
                      </header>
                      <nav
                        className="section-tabs"
                        aria-label="Relationship view"
                      >
                        {projectionIntents.map((value) => (
                          <button
                            type="button"
                            className={section === value ? "active" : ""}
                            key={value}
                            onClick={() =>
                              void chooseRefund(detail.caseId, value)
                            }
                          >
                            {label(value)}
                          </button>
                        ))}
                      </nav>
                      <DetailRows refund={detail} />
                      {detail.state === "eligible" && (
                        <form className="action-panel" onSubmit={requestRefund}>
                          <ExpectedActor name={detail.nextActorDisplayName} />
                          <label>
                            Reason
                            <select
                              value={reasonCategory}
                              onChange={(event) =>
                                setReasonCategory(
                                  event.target.value as ReasonCategory,
                                )
                              }
                            >
                              {reasonCategories.map((value) => (
                                <option value={value} key={value}>
                                  {label(value)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Details <span>(optional)</span>
                            <textarea
                              maxLength={240}
                              rows={2}
                              value={reason}
                              onChange={(event) =>
                                setReason(event.target.value)
                              }
                            />
                          </label>
                          <button
                            type="submit"
                            className="primary"
                            disabled={busy}
                          >
                            Request refund
                          </button>
                        </form>
                      )}
                      {detail.state === "requested" && (
                        <div className="action-panel">
                          <ExpectedActor name={detail.nextActorDisplayName} />
                          <button
                            type="button"
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              void act("approval", {
                                expectedVersion: detail.version,
                              })
                            }
                          >
                            Approve refund
                          </button>
                        </div>
                      )}
                      {detail.state === "approved-awaiting-fraud" && (
                        <div className="action-panel">
                          <ExpectedActor name={detail.nextActorDisplayName} />
                          <div className="split-actions">
                            <button
                              type="button"
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                void act("fraud-review", {
                                  outcome: "clear",
                                  expectedVersion: detail.version,
                                })
                              }
                            >
                              Clear and refund
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void act("fraud-review", {
                                  outcome: "block",
                                  expectedVersion: detail.version,
                                })
                              }
                            >
                              Block
                            </button>
                          </div>
                        </div>
                      )}
                      {detail.view === "fraud" && detail.effect && (
                        <p className="effect-result">
                          <strong>Platform refund recorded</strong>
                          <span className="effect-id">
                            {detail.effect.id} · synthetic tutorial effect
                          </span>
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="empty-detail">
                      <h2>Choose a refund</h2>
                      <p>
                        Inspect each relationship, then perform the next
                        lifecycle action.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}
            {notice && (
              <p className="global-notice" role="status">
                {notice}
              </p>
            )}
          </>
        )}
      </main>
      <footer className="site-footer">
        <nav aria-label="Related resources">
          <a href="https://cedarling.dev">Cedarling.dev</a>
          <a href="https://docs.jans.io/stable/cedarling/">Cedarling Docs</a>
          <a href="https://gluu.org/agama-lab/">Agama Lab</a>
          <a href="https://docs.jans.io/stable/cedarling/reference/cedarling-lock-server/">
            Lock Server
          </a>
          <a href="https://gluu.org">Gluu</a>
        </nav>
      </footer>
    </div>
  );
}
