// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type ActorId,
  type Book,
  type OrderSummary,
  type ProjectionIntent,
  projectionIntents,
  type RefundMutationResult,
  type RefundState,
  type RefundSummary,
  type RefundViewResult,
  type SessionView,
} from "../src/shared/protocol.ts";
import { App } from "../src/web/App.tsx";

let root: Root;
let container: HTMLDivElement;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const session = (id: ActorId = "bao"): SessionView => ({
  user: {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    role:
      id === "bao"
        ? "buyer"
        : id === "sela"
          ? "seller"
          : id === "diego"
            ? "support"
            : "fraud",
  },
  csrfToken: "csrf",
  expiresAt: Date.now() + 100_000,
});
const book = {
  id: "book-perimeter",
  title: "Securing the Perimeter",
  authors: "Michael Schwartz and Maciej Machulak",
  summary: "Identity and access management.",
  coverKey: "securing-perimeter",
  storeId: "store-sela",
  sellerDisplayName: "Sela Books",
  amountMinor: 5499,
  currency: "USD",
  version: 1,
} satisfies Book;
const summary = {
  caseId: "refund-bao-001",
  orderId: "order-bao-001",
  bookTitle: book.title,
  buyerDisplayName: "Bao",
  sellerDisplayName: "Sela Books",
  amountMinor: 5499,
  currency: "USD",
  state: "eligible",
  version: 0,
  updatedAt: Date.now(),
} satisfies RefundSummary;
function detail(
  state: RefundState = "eligible",
  view: ProjectionIntent = "buyer",
  caseId = summary.caseId,
): RefundViewResult {
  const common = {
    ...summary,
    caseId,
    bookTitle: caseId === "refund-second" ? "Another purchase" : book.title,
    state,
    version: state === "eligible" ? 0 : state === "requested" ? 1 : 2,
    nextActorDisplayName:
      state === "eligible"
        ? "Bao"
        : state === "requested"
          ? "Diego"
          : state === "approved-awaiting-fraud"
            ? "Nia"
            : null,
  };
  const request = {
    reasonCategory: null,
    reason: null,
    requestedBy: null,
    requestedAt: null,
  };
  const requestId = "detail";
  switch (view) {
    case "buyer":
      return {
        refund: { ...common, ...request, view, expectedBuyer: "Bao" },
        requestId,
      };
    case "seller":
      return {
        refund: {
          ...common,
          view,
          expectedSeller: "Sela Books",
          fulfillmentState: "fulfilled",
          reasonCategory: null,
          requestedAt: null,
        },
        requestId,
      };
    case "support":
      return {
        refund: {
          ...common,
          ...request,
          view,
          expectedApprover: "Diego",
          assignment: {
            caseId,
            status: "active",
            expiresAt: Date.now() + 100_000,
            limitMinor: 10_000,
            currency: "USD",
          },
          approvedBy: null,
          approvedAt: null,
          fraudStatus:
            state === "completed"
              ? "cleared"
              : state === "fraud-blocked"
                ? "blocked"
                : state === "approved-awaiting-fraud"
                  ? "pending"
                  : "not-started",
        },
        requestId,
      };
    case "fraud":
      return {
        refund: {
          ...common,
          view,
          expectedReviewer: "Nia",
          riskLabel: "Routine review",
          riskCode: "routine",
          supportApproval: { actor: null, time: null },
          fraudAssignment: { reviewer: "Nia", status: "active" },
          review: { outcome: null, actor: null, time: null },
          effect: null,
        },
        requestId,
      };
  }
}

function requestedDetail(path: string, state: RefundState = "eligible") {
  const url = new URL(path, "http://localhost");
  const view = projectionIntents.find(
    (value) => value === url.searchParams.get("section"),
  );
  if (!view) throw new Error(`Unexpected projection: ${path}`);
  return detail(state, view, url.pathname.split("/").at(-1));
}
function router(id: ActorId = "bao", hasOrder = false) {
  let purchased = hasOrder;
  const order = {
    id: "order-new",
    bookId: book.id,
    bookTitle: book.title,
    buyerId: id,
    buyerDisplayName: "Bao",
    sellerDisplayName: "Sela Books",
    amountMinor: 5499,
    currency: "USD",
    paymentState: "paid",
    fulfillmentState: "fulfilled",
    createdAt: Date.now(),
    version: 1,
    refund: { id: "refund-new", state: "eligible", version: 0 },
  } satisfies OrderSummary;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/session") return reply(session(id));
    if (path === "/api/catalog")
      return reply({ books: [book], requestId: "catalog" });
    if (path === "/api/orders" && init?.method === "POST") {
      purchased = true;
      return reply({
        order,
        requestId: "buy",
      });
    }
    if (path === "/api/orders")
      return reply({ orders: purchased ? [order] : [], requestId: "orders" });
    if (path === "/api/refunds")
      return reply({ refunds: [summary], requestId: "refunds" });
    if (path.includes("/api/refunds/refund-bao-001?section="))
      return reply(requestedDetail(path));
    if (path.endsWith("/request"))
      return reply({
        caseId: summary.caseId,
        state: "requested",
        version: 1,
        requestId: "request",
      });
    if (path.endsWith("/approval"))
      return reply({
        caseId: summary.caseId,
        state: "approved-awaiting-fraud",
        version: 2,
        requestId: "approve",
      });
    return reply({}, 404);
  });
}
function button(name: string) {
  const value = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(name),
  );
  if (!value) throw new Error(`Missing button: ${name}`);
  return value as HTMLButtonElement;
}

function refundRouter(initialState: RefundState = "eligible") {
  let state = initialState;
  const fallback = router();
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/refunds")
      return reply({
        refunds: [
          { ...summary, state },
          {
            ...summary,
            caseId: "refund-second",
            bookTitle: "Another purchase",
          },
        ],
        requestId: "refunds",
      });
    if (path.startsWith("/api/refunds/") && path.includes("?section=")) {
      return reply(requestedDetail(path, state));
    }
    if (init?.method === "POST" && path.startsWith("/api/refunds/")) {
      state = path.endsWith("/request")
        ? "requested"
        : path.endsWith("/approval")
          ? "approved-awaiting-fraud"
          : JSON.parse(String(init.body)).outcome === "clear"
            ? "completed"
            : "fraud-blocked";
      return reply({
        caseId: path.split("/")[3] ?? summary.caseId,
        state,
        version: 3,
        requestId: "mutation",
        ...(state === "completed"
          ? { effect: { id: "effect-confirmed", synthetic: true } }
          : {}),
      } satisfies RefundMutationResult);
    }
    return fallback(input, init);
  });
}

async function openFirstRefund() {
  await act(async () => root.render(<App />));
  await act(async () => button("Refunds").click());
  await act(async () => button(book.title).click());
}

async function enterReason(value: string) {
  const field = container.querySelector("textarea");
  if (!field) throw new Error("Missing reason field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState({}, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("uses the shared rail, focused identity chooser, and standard footer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply({}, 401)),
  );
  await act(async () => root.render(<App />));
  expect(container.querySelector(".topbar-copy h1")?.textContent).toBe(
    "P15 - Authorizing a Multi-Party Marketplace Refund with Cedarling",
  );
  expect(container.querySelectorAll(".account-choice")).toHaveLength(4);
  expect(container.querySelectorAll(".site-footer a")).toHaveLength(5);
});

it("shows a catalog book and creates one simulated order", async () => {
  const fetcher = router("nia");
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<App />));
  expect(container.textContent).toContain("Securing the Perimeter");
  await act(async () => button("Buy").click());
  expect(container.textContent).toContain(
    "“Securing the Perimeter” ordered successfully.",
  );
  expect(window.location.search).toBe("?view=orders&order=order-new");
  expect(container.querySelector(".queue-row.selected")?.textContent).toContain(
    book.title,
  );
  expect(container.querySelector(".detail-heading h2")?.textContent).toBe(
    book.title,
  );
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find((call) => call[1]?.method === "POST")?.[1]
          ?.body,
      ),
    ),
  ).toEqual({ bookId: book.id, expectedVersion: 1 });
});

it("renders shared order and refund queues rather than one hidden case", async () => {
  vi.stubGlobal("fetch", router());
  await act(async () => root.render(<App />));
  await act(async () => button("Orders").click());
  expect(container.textContent).toContain("All fulfilled orders");
  await act(async () => button("Refunds").click());
  expect(container.textContent).toContain("1 cases");
  expect(container.textContent).toContain(book.title);
});

it.each(["orders", "refunds"])(
  "Back to %s restores focus to its selected row",
  async (view) => {
    vi.stubGlobal("fetch", router("bao", true));
    await act(async () => root.render(<App />));
    await act(async () =>
      button(view === "orders" ? "Orders" : "Refunds").click(),
    );
    const row = button(book.title);
    await act(async () => row.click());
    expect(container.querySelector(".queue-view.has-detail")).not.toBeNull();
    await act(async () => button(`Back to ${view}`).click());
    expect(container.querySelector(".queue-view.has-detail")).toBeNull();
    await act(async () => {
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(row);
  },
);

it("lets any identity inspect sections and try the lifecycle-legal action", async () => {
  vi.stubGlobal("fetch", router("sela"));
  await act(async () => root.render(<App />));
  await act(async () => button("Refunds").click());
  await act(async () => button(book.title).click());
  expect(container.textContent).toContain("Expected actor: Bao");
  expect(button("Request refund").disabled).toBe(false);
  await act(async () => button("support").click());
  expect(container.textContent).toContain("Expected approver");
  expect(container.textContent).toContain("Diego");
  expect(container.textContent).toContain("Assignment");
  expect(container.querySelector(".section-tabs .active")?.textContent).toBe(
    "support",
  );
  expect(window.location.search).toBe(
    "?view=refunds&refund=refund-bao-001&section=support",
  );
});

it("selects an order and writes its URL", async () => {
  window.history.replaceState({}, "", "/?view=orders");
  vi.stubGlobal("fetch", router("bao", true));
  await act(async () => root.render(<App />));
  await act(async () => button(book.title).click());
  expect(container.querySelector(".queue-row.selected")?.textContent).toContain(
    book.title,
  );
  expect(container.querySelector(".detail-heading h2")?.textContent).toBe(
    book.title,
  );
  expect(window.location.search).toBe("?view=orders&order=order-new");
});

it("restores order detail from the initial URL without selecting a row", async () => {
  window.history.replaceState({}, "", "/?view=orders&order=order-new");
  vi.stubGlobal("fetch", router("bao", true));
  await act(async () => root.render(<App />));
  expect(container.querySelector(".queue-row.selected")?.textContent).toContain(
    book.title,
  );
  expect(container.querySelector(".detail-heading h2")?.textContent).toBe(
    book.title,
  );
});

it("clears the purchase receipt when refreshing orders reveals an expired session", async () => {
  const fallback = router();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/orders" && init?.method !== "POST"
      ? reply({ error: "UNAUTHENTICATED" }, 401)
      : fallback(input, init),
  );
  await act(async () => root.render(<App />));
  await act(async () => button("Buy").click());
  expect(container.textContent).toContain("Session expired");
  expect(container.textContent).toContain("Choose an identity");
  expect(container.textContent).not.toContain(book.title);
  expect(window.location.search).toBe("");
});

it.each([503, "network"] as const)(
  "keeps a confirmed purchase and reports an orders refresh failure (%s)",
  async (failure) => {
    const fallback = router();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/orders" && init?.method !== "POST")
        return failure === "network"
          ? Promise.reject(new TypeError("fetch failed"))
          : reply({ error: "UNAVAILABLE" }, failure);
      return fallback(input, init);
    });
    await act(async () => root.render(<App />));
    await act(async () => button("Buy").click());
    expect(container.textContent).toContain("ordered successfully.");
    expect(container.textContent).toContain(
      "The order list could not refresh.",
    );
    expect(container.querySelector(".detail-heading h2")?.textContent).toBe(
      book.title,
    );
    expect(
      fallback.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  },
);

it.each([204, 401, 503, "network"] as const)(
  "clears protected state and reports the sign-out outcome (%s)",
  async (status) => {
    const fallback = router("bao", true);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/auth/logout")
        return status === "network"
          ? Promise.reject(new TypeError("fetch failed"))
          : Promise.resolve(new Response(null, { status }));
      return fallback(input, init);
    });
    await act(async () => root.render(<App />));
    await act(async () => button("Orders").click());
    await act(async () => button(book.title).click());
    await act(async () => button("Sign out").click());
    expect(container.textContent).toContain("Choose an identity");
    expect(container.textContent).not.toContain(book.title);
    expect(container.textContent?.includes("Sign-out did not finish")).toBe(
      status === 503 || status === "network",
    );
  },
);

it("ignores an orders refresh response after changing accounts", async () => {
  let finishRefresh!: (response: Response) => void;
  const refresh = new Promise<Response>((resolve) => {
    finishRefresh = resolve;
  });
  const fallback = router();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/orders" && init?.method !== "POST")
      return refresh;
    if (String(input) === "/auth/logout")
      return Promise.resolve(new Response(null, { status: 204 }));
    return fallback(input, init);
  });
  await act(async () => root.render(<App />));
  await act(async () => button("Buy").click());
  await act(async () => button("Change account").click());
  await act(async () => {
    finishRefresh(await reply({ error: "UNAVAILABLE" }, 503));
  });
  expect(container.textContent).toContain("Choose an identity");
  expect(container.textContent).not.toContain(book.title);
  expect(container.textContent).not.toContain("could not refresh");
});

it("restores a selected refund projection from the URL", async () => {
  window.history.replaceState(
    {},
    "",
    "/?view=refunds&refund=refund-bao-001&section=fraud",
  );
  vi.stubGlobal("fetch", router());
  await act(async () => root.render(<App />));
  expect(container.querySelector(".queue-row.selected")?.textContent).toContain(
    book.title,
  );
  expect(container.querySelector(".section-tabs .active")?.textContent).toBe(
    "fraud",
  );
  expect(window.location.search).toBe(
    "?view=refunds&refund=refund-bao-001&section=fraud",
  );
});

it("does not restore protected refund state after switching identity", async () => {
  let resolveRequest!: (response: Response) => void;
  const request = new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  });
  const fallback = router();
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/request")) return request;
    if (path === "/auth/logout")
      return Promise.resolve(new Response(null, { status: 204 }));
    return fallback(input, init);
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<App />));
  await act(async () => button("Refunds").click());
  await act(async () => button(book.title).click());
  await enterReason("Private refund details");
  expect(container.querySelector("textarea")?.value).toBe(
    "Private refund details",
  );
  await act(async () => button("Request refund").click());
  await act(async () => button("Change account").click());
  expect(container.textContent).toContain("Choose an identity");
  expect(container.querySelector("textarea")).toBeNull();

  await act(async () => {
    resolveRequest(
      new Response(
        JSON.stringify({
          caseId: summary.caseId,
          state: "requested",
          version: 1,
          requestId: "request",
        }),
      ),
    );
    await request;
  });
  expect(container.textContent).toContain("Choose an identity");
  expect(container.textContent).not.toContain("Refund moved to requested");
  expect(
    fetcher.mock.calls.filter(([input]) => String(input) === "/api/refunds"),
  ).toHaveLength(1);
});

it.each([
  ["eligible", "Request refund", "Refund requested."],
  ["requested", "Approve refund", "Refund approved."],
  [
    "approved-awaiting-fraud",
    "Clear and refund",
    "Platform refund recorded once.",
  ],
  ["approved-awaiting-fraud", "Block", "Refund blocked."],
] as const)(
  "keeps the confirmed %s action when the following refresh fails",
  async (state, action, message) => {
    const fallback = refundRouter(state);
    let committed = false;
    let offline = true;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (committed && offline && String(input) === "/api/refunds")
        return Promise.reject(new TypeError("network failure"));
      if (init?.method === "POST") committed = true;
      return fallback(input, init);
    });
    await openFirstRefund();
    await act(async () => button(action).click());
    expect(container.textContent).toContain(message);
    expect(container.textContent).toContain("could not refresh");
    expect(container.querySelector(".action-panel")).toBeNull();
    expect(container.querySelector(".detail-rows")).toBeNull();
    await act(async () => button("Reload case").click());
    expect(container.textContent).toContain(message);
    offline = false;
    await act(async () => button("Reload case").click());
    expect(container.querySelector(".detail-rows")).not.toBeNull();
    expect(container.querySelectorAll(".queue-row")).toHaveLength(2);
    expect(
      fallback.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  },
);

it.each([503, 403, 404])(
  "does not reuse old case details after a confirmed approval and a %s read",
  async (status) => {
    const fallback = refundRouter("requested");
    let committed = false;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (committed && String(input).includes("?section="))
        return reply({ error: { code: "CASE_UNAVAILABLE" } }, status);
      if (init?.method === "POST") committed = true;
      return fallback(input, init);
    });
    await openFirstRefund();
    await act(async () => button("Approve refund").click());
    expect(container.textContent).toContain("Refund approved.");
    expect(container.querySelector(".action-panel, .detail-rows")).toBeNull();
  },
);

it.each(["queue", "case"])(
  "clears protected state when the %s refresh returns 401 and the other read fails",
  async (expired) => {
    const fallback = refundRouter("requested");
    let committed = false;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (
        committed &&
        (path === "/api/refunds" || path.includes("?section="))
      ) {
        const isExpired =
          expired === "queue"
            ? path === "/api/refunds"
            : path.includes("?section=");
        return isExpired
          ? reply({ error: { code: "UNAUTHENTICATED" } }, 401)
          : Promise.reject(new TypeError("network failure"));
      }
      if (init?.method === "POST") committed = true;
      return fallback(input, init);
    });
    await openFirstRefund();
    await act(async () => button("Approve refund").click());
    expect(container.textContent).toContain("Session expired");
    expect(
      container.querySelector(".queue-row, .detail-rows, .action-panel"),
    ).toBeNull();
    expect(container.textContent).not.toContain("Refund approved.");
  },
);

it("ignores a late refund refresh after changing accounts", async () => {
  const fallback = refundRouter("requested");
  let committed = false;
  let finish!: (response: Response) => void;
  const refresh = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/auth/logout")
      return Promise.resolve(new Response(null, { status: 204 }));
    if (committed && String(input) === "/api/refunds") return refresh;
    if (init?.method === "POST") committed = true;
    return fallback(input, init);
  });
  await openFirstRefund();
  await act(async () => button("Approve refund").click());
  await act(async () => button("Change account").click());
  await act(async () => finish(await reply({ refunds: [summary] })));
  expect(container.textContent).toContain("Choose an identity");
  expect(container.querySelector(".detail-rows, .action-panel")).toBeNull();
  expect(container.textContent).not.toContain("Refund approved.");
});

it("keeps the reason for the same case but clears it when another case is selected", async () => {
  vi.stubGlobal("fetch", refundRouter());
  await openFirstRefund();
  await enterReason("This package is missing.");
  const select = container.querySelector("select");
  if (!select) throw new Error("Missing reason category");
  await act(async () => {
    select.value = "not-received";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => button("seller").click());
  expect(container.querySelector("textarea")?.value).toBe(
    "This package is missing.",
  );
  expect(container.querySelector("select")?.value).toBe("not-received");
  await act(async () => button("Another purchase").click());
  expect(container.querySelector("textarea")?.value).toBe("");
  expect(container.querySelector("select")?.value).toBe("damaged");
});

it("resets the reason on history navigation to another case, not another view of the same case", async () => {
  vi.stubGlobal("fetch", refundRouter());
  await openFirstRefund();
  await enterReason("Private case explanation");
  for (const [id, expected] of [
    [summary.caseId, "Private case explanation"],
    ["refund-second", ""],
  ]) {
    await act(async () => {
      window.history.replaceState(
        {},
        "",
        `/?view=refunds&refund=${id}&section=buyer`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container.querySelector("textarea")?.value).toBe(expected);
  }
});

it("keeps the entered reason after a failed submission", async () => {
  const fallback = refundRouter();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST"
      ? reply({ error: { code: "INVALID_INPUT" } }, 400)
      : fallback(input, init),
  );
  await openFirstRefund();
  await enterReason("Keep this explanation");
  await act(async () => button("Request refund").click());
  expect(container.querySelector("textarea")?.value).toBe(
    "Keep this explanation",
  );
  expect(container.textContent).toContain("Check the form");
});

it("does not reopen a refund when a projection read finishes after Back", async () => {
  const pending = pendingResponse();
  const fallback = refundRouter();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith("?section=seller")
      ? pending.promise
      : fallback(input, init),
  );
  await openFirstRefund();
  await act(async () => button("seller").click());
  await act(async () => button("Back to refunds").click());
  await act(async () =>
    pending.resolve(await reply(detail("eligible", "seller"))),
  );
  expect(
    container.querySelector(".detail-heading, .queue-view.has-detail"),
  ).toBeNull();
  expect(container.querySelector("[aria-busy=true]")).toBeNull();
  expect(window.location.search).toBe("?view=refunds");
});

it("keeps an order selected while an older queue refresh finishes", async () => {
  const pending = pendingResponse();
  const fallback = router("bao", true);
  let delayRefresh = false;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    delayRefresh && String(input) === "/api/orders"
      ? pending.promise
      : fallback(input, init),
  );
  await act(async () => root.render(<App />));
  await act(async () => button("Orders").click());
  delayRefresh = true;
  await act(async () => button("Orders").click());
  await act(async () => button(book.title).click());
  await act(async () => pending.resolve(await fallback("/api/orders")));
  expect(container.querySelector(".detail-heading h2")?.textContent).toBe(
    book.title,
  );
  expect(container.querySelector("[aria-busy=true]")).toBeNull();
  expect(window.location.search).toBe("?view=orders&order=order-new");
});

it("keeps the latest case selection when an older read finishes", async () => {
  const pending = pendingResponse();
  const fallback = refundRouter();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes(`${summary.caseId}?section=`)
      ? pending.promise
      : fallback(input, init),
  );
  await openFirstRefund();
  await act(async () => button("Another purchase").click());
  await act(async () => pending.resolve(await reply(detail())));
  expect(container.querySelector(".detail-heading h2")?.textContent).toBe(
    "Another purchase",
  );
  expect(window.location.search).toContain("refund=refund-second");
});

it.each(["queue", "case"])(
  "clears an expired session before the other %s refresh settles",
  async (expired) => {
    const pending = pendingResponse();
    const fallback = refundRouter("requested");
    let committed = false;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (
        committed &&
        (path === "/api/refunds" || path.includes("?section="))
      ) {
        const isExpired =
          expired === "queue"
            ? path === "/api/refunds"
            : path.includes("?section=");
        return isExpired
          ? reply({ error: { code: "SESSION_EXPIRED" } }, 401)
          : pending.promise;
      }
      if (init?.method === "POST") committed = true;
      return fallback(input, init);
    });
    await openFirstRefund();
    await act(async () => button("Approve refund").click());
    try {
      expect(container.textContent).toContain("Choose an identity");
      expect(
        container.querySelector(".queue-row, .detail-rows, .refund-receipt"),
      ).toBeNull();
    } finally {
      await act(async () =>
        pending.resolve(
          await fallback(
            expired === "queue"
              ? `/api/refunds/${summary.caseId}?section=buyer`
              : "/api/refunds",
          ),
        ),
      );
    }
    expect(container.textContent).toContain("Choose an identity");
    expect(container.textContent).not.toContain("Refund approved.");
    expect(window.location.search).toBe("");
  },
);

it.each([null, "Unauthorized"])(
  "clears the purchase receipt on a non-JSON 401 (%s)",
  async (body) => {
    const fallback = router();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/orders" && init?.method !== "POST"
        ? Promise.resolve(new Response(body, { status: 401 }))
        : fallback(input, init),
    );
    await act(async () => root.render(<App />));
    await act(async () => button("Buy").click());
    expect(container.textContent).toContain("Choose an identity");
    expect(container.textContent).not.toContain(book.title);
    expect(window.location.search).toBe("");
  },
);
