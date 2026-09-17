// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/web/App.tsx";

let root: Root;
let container: HTMLDivElement;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const session = (id: "bao" | "sela" | "diego" | "nia" = "bao") => ({
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
};
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
};
const detail = (state = "eligible") => ({
  refund: {
    ...summary,
    state,
    version: state === "eligible" ? 0 : state === "requested" ? 1 : 2,
    view: "buyer",
    nextActorDisplayName:
      state === "eligible" ? "Bao" : state === "requested" ? "Diego" : "Nia",
    expectedBuyer: "Bao",
    reasonCategory: null,
    reason: null,
    requestedBy: null,
    requestedAt: null,
  },
  requestId: "detail",
});
function router(
  id: "bao" | "sela" | "diego" | "nia" = "bao",
  hasOrder = false,
) {
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
  };
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
      return reply(detail());
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

it("shows the five-book store and creates one simulated order", async () => {
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

it("lets any identity inspect sections and try the lifecycle-legal action", async () => {
  vi.stubGlobal("fetch", router("sela"));
  await act(async () => root.render(<App />));
  await act(async () => button("Refunds").click());
  await act(async () => button(book.title).click());
  expect(container.textContent).toContain("Expected actor: Bao");
  expect(button("Request refund").disabled).toBe(false);
  await act(async () => button("support").click());
  expect(container.querySelector(".section-tabs .active")?.textContent).toBe(
    "support",
  );
  expect(window.location.search).toBe(
    "?view=refunds&refund=refund-bao-001&section=support",
  );
});

it("selects orders and restores order detail from the URL", async () => {
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

it("uses separate list and detail regions for responsive navigation", async () => {
  vi.stubGlobal("fetch", router());
  await act(async () => root.render(<App />));
  await act(async () => button("Refunds").click());
  await act(async () => button(book.title).click());
  expect(container.querySelector(".queue-view.has-detail")).not.toBeNull();
  expect(button("Back to refunds")).not.toBeNull();
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
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Missing refund details field");
  await act(async () => {
    textarea.value = "Private refund details";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
