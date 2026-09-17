// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/web/App.tsx";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { data, requestId: "req_test" }
        : {
            error: { code: "DENIED", message: "Contact access denied." },
            requestId: "req_denied",
          },
    ),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
function button(text: string) {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function settle(action: () => void) {
  await act(async () => {
    action();
    await new Promise((done) => setTimeout(done, 10));
  });
}
const ben = {
  user: { id: "ben", name: "Ben", role: "Manager" },
  csrfToken: "csrf",
  expiresAt: Date.now() + 60000,
};
const cora = {
  id: "cora",
  name: "Cora",
  managerId: "ben",
  managerName: "Ben",
  team: "Support",
  jobTitle: "Specialist",
  version: 1,
};
function expectProgramHeading() {
  expect(host.querySelector("header h1")?.textContent).toBe(
    "P12 - Governing Employee Record Access with Cedarling",
  );
  expect(host.querySelector(".topbar-copy p")?.textContent).toBe(
    "Request, review, and revoke access to employee contact fields.",
  );
}
it("uses the P1 identity panel and common program title before login", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(null)),
  );
  await settle(() => root.render(<App />));
  expectProgramHeading();
  expect(host.querySelector(".login-heading h2")?.textContent).toBe(
    "Choose a tutorial identity",
  );
  expect(
    [...host.querySelectorAll(".account-choice")].map((link) => ({
      href: link.getAttribute("href"),
      name: link.querySelector(".account-copy strong")?.textContent,
      avatar: link.querySelector(".account-avatar")?.textContent,
    })),
  ).toEqual([
    { href: "/auth/login?login_hint=lin", name: "Lin", avatar: "L" },
    { href: "/auth/login?login_hint=nia", name: "Nia", avatar: "N" },
    { href: "/auth/login?login_hint=ben", name: "Ben", avatar: "B" },
  ]);
  expect(host.querySelector(".rail-identity")).toBeNull();
});
it("closes the request dialog and selects a visible active grant after a duplicate race", async () => {
  const active = {
    id: "g-active",
    employeeId: "cora",
    employeeName: "Cora",
    managerId: "ben",
    managerName: "Ben",
    requesterName: "Lin",
    status: "approved",
    expiresAt: Date.now() + 60_000,
    version: 2,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session")
        return response({
          ...ben,
          user: { id: "lin", name: "Lin", role: "Reviewer" },
        });
      if (path === "/api/employees") return response([cora]);
      if (path === "/api/employees/cora/profile") return response(cora);
      if (path === "/api/grants?view=review") {
        return response([active]);
      }
      if (path === "/api/grants")
        return new Response(
          JSON.stringify({
            error: {
              code: "ACTIVE_GRANT_EXISTS",
              message: "Ben already has an active access grant.",
            },
            requestId: "req_active",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      if (path === "/api/grants/g-active") return response(active);
      throw new Error(`Unexpected request: ${path}`);
    }),
  );

  await settle(() => root.render(<App />));
  await settle(() => button("CoraSupport").click());
  await settle(() => button("Request access").click());
  await settle(() =>
    host.querySelector<HTMLFormElement>("dialog form")?.requestSubmit(),
  );

  expect(host.querySelector("dialog")).toBeNull();
  expect(host.querySelector('[data-resource-id="g-active"]')).not.toBeNull();
  expect(host.textContent).toContain("Cora");
});
it("opens an already-listed pending grant from the access requests view", async () => {
  const active = {
    id: "g-pending",
    employeeId: "cora",
    employeeName: "Cora",
    managerId: "ben",
    managerName: "Ben",
    requesterName: "Lin",
    status: "pending",
    expiresAt: Date.now() + 60_000,
    version: 1,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session")
        return response({
          ...ben,
          user: { id: "lin", name: "Lin", role: "Reviewer" },
        });
      if (path === "/api/grants?view=review") return response([active]);
      if (path === "/api/grants/g-pending") return response(active);
      throw new Error(`Unexpected request: ${path}`);
    }),
  );

  await settle(() => root.render(<App />));
  await settle(() => button("Access requests").click());
  await settle(() => button("CoraBen · requested by Linpending").click());

  expect(host.querySelector("dialog")).toBeNull();
  expect(host.textContent).toContain("Approve");
});
it.each(["lin", "nia", "ben"])(
  "keeps the program title and compact task shell for %s after login",
  async (id) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        response(
          path === "/api/session"
            ? { ...ben, user: { id, name: id, role: "Reviewer" } }
            : [],
        ),
      ),
    );
    await settle(() => root.render(<App />));
    expectProgramHeading();
    expect(host.querySelector(".list-heading h2")?.textContent).toBe(
      id === "nia" ? "Access requests" : "Employees",
    );
    expect(host.querySelector(".identity-avatar")?.textContent).toBe(id[0]);
    expect(host.querySelector(".login-panel")).toBeNull();
    expect(
      host.querySelector(".workspace.no-selection > .ledger + .detail"),
    ).not.toBeNull();
  },
);
it("clears denied contact fields while retaining independently allowed basic fields", async () => {
  let deny = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session") return response(ben);
      if (path === "/api/employees") return response([cora]);
      if (path.endsWith("/profile")) return response(cora);
      return deny
        ? response(null, 403)
        : response({
            id: "cora",
            workEmail: "private@example.test",
            workPhone: "555",
            version: 1,
          });
    }),
  );
  await settle(() => root.render(<App />));
  await settle(() => button("CoraSupport").click());
  expect(host.textContent).toContain("private@example.test");
  deny = true;
  await settle(() => button("Refresh").click());
  expect(host.textContent).not.toContain("private@example.test");
  expect(host.textContent).toContain("Specialist");
  expect(host.textContent).toContain("Contact access denied.");
});
it("account change discards late protected responses", async () => {
  let release: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session") return response(ben);
      if (path === "/api/employees") return response([cora]);
      if (path.endsWith("/profile")) return response(cora);
      if (path === "/auth/logout") return new Response(null, { status: 204 });
      return new Promise<Response>((done) => {
        release = done;
      });
    }),
  );
  await settle(() => root.render(<App />));
  await settle(() => button("CoraSupport").click());
  const accountMenu = host.querySelector<HTMLElement>(
    '[aria-label="Open account menu"]',
  );
  if (!accountMenu) throw new Error("Missing account menu");
  await settle(() => accountMenu.click());
  await settle(() => button("Change account").click());
  expect(host.textContent).toContain("Choose a tutorial identity");
  await settle(() =>
    release?.(
      response({
        id: "cora",
        workEmail: "late-secret@example.test",
        workPhone: "555",
        version: 1,
      }),
    ),
  );
  expect(host.textContent).not.toContain("late-secret");
  expect(host.textContent).not.toContain("Specialist");
});
it("keeps employee request actions and terminal grants reachable without diagnostic UI", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/session")
        return response({
          ...ben,
          user: { id: "lin", name: "Lin", role: "Reviewer" },
        });
      if (path === "/api/employees") return response([cora]);
      if (path.endsWith("/profile")) return response(cora);
      return response([
        {
          id: "g1",
          employeeId: "cora",
          employeeName: "Cora",
          managerName: "Ben",
          requesterName: "Lin",
          status: "revoked",
        },
      ]);
    }),
  );
  await settle(() => root.render(<App />));
  await settle(() => button("CoraSupport").click());
  expect(button("Request access")).toBeDefined();
  await settle(() => button("Access requests").click());
  expect(host.textContent).toContain("revoked");
  expect(host.querySelector("footer nav")?.textContent).toBe(
    "Cedarling.devCedarling DocsAgama LabLock ServerGluu",
  );
  expect(host.textContent).not.toMatch(
    /FAKE ALLOW|Cedarling was not called|Policy diagnostics/,
  );
});
it("refreshes grant state after updates and renders one coherent success or failure notice", async () => {
  let grant = {
    id: "g1",
    employeeId: "cora",
    employeeName: "Cora",
    managerName: "Ben",
    requesterName: "Lin",
    status: "pending",
    expiresAt: Date.now() + 60_000,
    version: 1,
  };
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push(path);
      if (path === "/api/session")
        return response({
          ...ben,
          user: { id: "lin", name: "Lin", role: "Reviewer" },
        });
      if (path === "/api/grants?view=review") return response([grant]);
      if (path === "/api/grants/g1/approve") {
        expect(init?.body).toBe(JSON.stringify({ version: 1 }));
        expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf");
        grant = { ...grant, status: "approved", version: 2 };
        return response(grant);
      }
      if (path === "/api/grants/g1/revoke")
        return new Response(
          JSON.stringify({
            error: { message: "Grant update denied." },
            requestId: "req_denied",
          }),
          { status: 403 },
        );
      return response(grant);
    }),
  );
  await settle(() => root.render(<App />));
  await settle(() => button("Access requests").click());
  await settle(() => button("CoraBen · requested by Linpending").click());
  calls.length = 0;
  await settle(() => button("Approve").click());
  expect(host.querySelector('.notice[role="status"]')?.textContent).toBe(
    "Access approved. (req_test)",
  );
  expect(calls).toContain("/api/grants?view=review");
  expect(calls).toContain("/api/grants/g1");
  calls.length = 0;
  await settle(() => button("Revoke").click());
  expect(host.querySelector('.notice[role="alert"]')?.textContent).toBe(
    "Grant update denied. (req_denied)",
  );
  expect(host.querySelector('.notice[role="status"]')).toBeNull();
  expect(calls).toContain("/api/grants?view=review");
  expect(calls).toContain("/api/grants/g1");
});
it.each(["nia", "ben"])(
  "moves narrow-screen focus into %s details and back to its row",
  async (id) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const grant = {
      id: "g1",
      employeeId: "cora",
      employeeName: "Cora",
      managerName: "Ben",
      requesterName: "Lin",
      status: "revoked",
      expiresAt: Date.now() + 60_000,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/session")
          return response({ ...ben, user: { id, name: id, role: "Reviewer" } });
        if (path === "/api/employees") return response([cora]);
        if (path === "/api/grants?view=review") return response([grant]);
        if (path === "/api/grants/g1") return response(grant);
        if (path.endsWith("/profile")) return response(cora);
        return response({
          id: "cora",
          workEmail: "private@example.test",
          workPhone: "555",
          version: 1,
        });
      }),
    );
    await settle(() => root.render(<App />));
    const row = host.querySelector<HTMLButtonElement>(".resource-row");
    if (!row) throw new Error("Missing row");
    row.focus();
    await settle(() => row.click());
    expect(document.activeElement).toBe(host.querySelector(".detail"));
    await settle(() =>
      button(id === "ben" ? "Back to employees" : "Back to access").click(),
    );
    expect(document.activeElement).toBe(row);
  },
);
