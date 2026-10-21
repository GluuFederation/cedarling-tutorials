// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  accessPackages,
  type Grant,
  type Profile,
} from "../src/shared/contracts.ts";
import { App } from "../src/web/App.tsx";
import { routes } from "../src/web/routes.tsx";

let host: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter> | undefined;
const cora: Profile = {
  id: "cora",
  employeeNumber: "EMP-1001",
  name: "Cora Mensah",
  preferredName: "Cora",
  managerId: "ben",
  managerName: "Ben",
  team: "Support",
  jobTitle: "Support specialist",
  office: "Cotonou",
  employmentType: "Permanent",
  employmentStatus: "Active",
  startDate: "2023-06-05",
  version: 1,
};
const dee: Profile = {
  ...cora,
  id: "other-team",
  employeeNumber: "EMP-1004",
  name: "Dee Okafor",
  team: "Operations",
  managerName: "Morgan",
};
const session = {
  user: { id: "ben", name: "Ben", role: "Manager" },
  csrfToken: "csrf",
  expiresAt: Date.now() + 60000,
};
const contact = {
  id: "cora",
  workEmail: "private@example.test",
  workPhone: "555",
  personalEmail: "personal@example.test",
  mobilePhone: "555",
  address: "Sample street",
  emergencyName: "Taylor",
  emergencyRelationship: "Family",
  emergencyPhone: "555",
  version: 1,
};
const medical = {
  id: "cora",
  dateOfBirth: "1992-04-16",
  bloodGroup: "O+",
  allergies: ["Seasonal pollen"],
  conditions: [],
  medications: [],
  consultations: [],
  testResults: [],
  vaccinations: [],
  assessments: [],
  version: 1,
};
const grant: Grant = {
  id: "g1",
  packageId: "team-support",
  packageName: "Contact details",
  employeeId: "cora",
  employeeName: "Cora Mensah",
  requesterId: "lin",
  requesterName: "Lin",
  beneficiaryId: "ben",
  beneficiaryName: "Ben",
  scope: "current-direct-reports",
  reason: "Coordinate employee support arrangements.",
  durationDays: 2,
  status: "pending",
  createdAt: Date.now(),
  reviewDeadline: Date.now() + 86400000,
  approvedAt: null,
  expiresAt: null,
  reviewedBy: null,
  reviewerName: null,
  reviewedAt: null,
  reviewNote: null,
  revokedBy: null,
  revokerName: null,
  revokedAt: null,
  version: 1,
};
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { data, requestId: "req_test" }
        : {
            error: { code: "DENIED", message: "Access denied." },
            requestId: "req_denied",
          },
    ),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
function defaults(path: string): Response {
  if (path === "/api/session") return response(session);
  if (path === "/api/employees") return response([cora, dee]);
  if (path.endsWith("/profile")) return response(cora);
  if (path.endsWith("/contact")) return response(contact);
  if (path.endsWith("/medical")) return response(medical);
  if (path === "/api/access-options")
    return response({
      packages: accessPackages,
      beneficiaries: [
        { id: "aya", name: "Dr. Aya", role: "Occupational-health clinician" },
        { id: "ben", name: "Ben", role: "Manager" },
      ],
    });
  if (path.startsWith("/api/grants?")) return response([grant]);
  if (path.startsWith("/api/grants/g1")) return response(grant);
  throw new Error(`Unexpected request: ${path}`);
}
async function settle(action: () => unknown) {
  await act(async () => {
    await action();
    await new Promise((done) => setTimeout(done, 15));
  });
}
async function render(path = "/employees") {
  await settle(() => {
    router = createMemoryRouter(routes, { initialEntries: [path] });
    root.render(<App router={router} />);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => defaults(path)),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  router = undefined;
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("provides all four sign-ins and secure resource links in the shared shell", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(null)),
  );
  await render("/");
  expect(host.querySelectorAll(".account-choice")).toHaveLength(4);
  expect(host.textContent).toContain("Dr. Aya");
  expect(
    [...host.querySelectorAll("footer a")].every(
      (link) =>
        link.getAttribute("target") === "_blank" &&
        link.getAttribute("rel")?.includes("noopener"),
    ),
  ).toBe(true);
});
it.each(["lin", "nia", "ben", "aya"])(
  "keeps directory, review and sensitive-record pages reachable for %s in the baseline",
  async (id) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/session"
          ? response({
              ...session,
              user: { id, name: id, role: "Tutorial role" },
            })
          : defaults(path),
      ),
    );
    await render();
    expect(host.querySelector('a[href="/access-requests"]')).not.toBeNull();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    await settle(() => router?.navigate("/employees/cora/contact"));
    expect(host.textContent).toContain("private@example.test");
    await settle(() => router?.navigate("/employees/cora/medical"));
    expect(host.textContent).toContain("Seasonal pollen");
    expect(
      host.querySelector('a[href*="/access-requests/new"]'),
    ).not.toBeNull();
  },
);
it("filters the employee table through URL state without downloading private groups", async () => {
  await render("/employees?q=EMP-1004&department=Operations");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(host.textContent).toContain("Dee Okafor");
  const calls = vi.mocked(fetch).mock.calls.map(([path]) => String(path));
  expect(
    calls.some(
      (path) => path.endsWith("/contact") || path.endsWith("/medical"),
    ),
  ).toBe(false);
  await settle(() =>
    router?.navigate("/employees/cora?from=department%3DSupport"),
  );
  expect(host.querySelector(".back-link")?.getAttribute("href")).toBe(
    "/employees?department=Support",
  );
});
it("clears a denied medical response while retaining the independently loaded employee profile", async () => {
  let deny = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path.endsWith("/medical") && deny ? response(null, 403) : defaults(path),
    ),
  );
  await render("/employees/cora/medical");
  expect(host.textContent).toContain("Seasonal pollen");
  deny = true;
  await settle(() => router?.revalidate());
  expect(host.textContent).not.toContain("Seasonal pollen");
  expect(host.textContent).toContain("Cora Mensah");
  expect(host.textContent).toContain("Access not allowed");
  expect(
    host.querySelector(
      'a[href="/access-requests/new?employee=cora&package=occupational-health"]',
    ),
  ).not.toBeNull();
});
it("distinguishes a request's beneficiary and medical package in the submission", async () => {
  let body: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/grants") {
        body = JSON.parse(String(init?.body));
        return response(grant);
      }
      return defaults(path);
    }),
  );
  const formData = new FormData();
  Object.entries({
    employeeId: "cora",
    packageId: "occupational-health",
    beneficiaryId: "aya",
    days: "2",
    reason: "Review an occupational-health case.",
  }).forEach(([key, value]) => {
    formData.set(key, value);
  });
  await render(
    "/access-requests/new?employee=cora&package=occupational-health",
  );
  expect(host.querySelector('select[name="beneficiaryId"]')).not.toBeNull();
  await settle(() =>
    router?.navigate("/access-requests/new", { formMethod: "post", formData }),
  );
  expect(body).toEqual({
    employeeId: "cora",
    packageId: "occupational-health",
    beneficiaryId: "aya",
    days: 2,
    reason: "Review an occupational-health case.",
  });
  expect(router?.state.location.pathname).toBe("/access-requests/g1");
});
it("retains form values after a failed submission and opens an existing request after a duplicate", async () => {
  let duplicate = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/grants")
        return new Response(
          JSON.stringify({
            error: {
              code: duplicate ? "ACTIVE_GRANT_EXISTS" : "CONFLICT",
              message: "Refresh and try again.",
            },
            requestId: "req_conflict",
          }),
          { status: 409 },
        );
      return defaults(path);
    }),
  );
  await render("/access-requests/new?employee=cora");
  const form = new FormData();
  Object.entries({
    employeeId: "cora",
    packageId: "team-support",
    days: "2",
    reason: "Coordinate employee support arrangements.",
  }).forEach(([key, value]) => {
    form.set(key, value);
  });
  const input = host.querySelector<HTMLTextAreaElement>("textarea");
  if (!input) throw Error("Missing reason");
  await settle(() => {
    input.value = "Keep this request reason.";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(() =>
    router?.navigate("/access-requests/new?employee=cora", {
      formMethod: "post",
      formData: form,
    }),
  );
  expect(host.textContent).toContain("Refresh and try again.");
  expect(host.querySelector("textarea")?.value).toBe(
    "Keep this request reason.",
  );
  duplicate = true;
  await settle(() =>
    router?.navigate("/access-requests/new?employee=cora", {
      formMethod: "post",
      formData: form,
    }),
  );
  expect(router?.state.location.pathname).toBe("/access-requests/g1");
  expect(host.textContent).toContain("Opened the existing request.");
});
it("clears protected content after expiry or sign-out and discards late responses", async () => {
  let signedOut = false;
  let release: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/auth/logout") {
        signedOut = true;
        return new Response(null, { status: 204 });
      }
      if (path === "/api/session") return response(signedOut ? null : session);
      if (path.endsWith("/medical"))
        return new Promise<Response>((done) => {
          release = done;
        });
      return defaults(path);
    }),
  );
  await render("/employees/cora/contact");
  await settle(() => {
    void router?.navigate("/employees/cora/medical");
  });
  const signOut = new FormData();
  await settle(() =>
    router?.navigate("/sign-out", { formMethod: "post", formData: signOut }),
  );
  expect(host.textContent).toContain("Choose a tutorial identity");
  await settle(() => release?.(response(medical)));
  expect(host.textContent).not.toContain("Seasonal pollen");
  expect(host.textContent).not.toContain("private@example.test");
});
