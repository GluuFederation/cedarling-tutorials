import { RouterContextProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RequestServices,
  requestServicesContext,
} from "../app/context.ts";
import { loader as rootLoader } from "../app/root.tsx";
import { loader as callbackLoader } from "../app/routes/auth/callback.ts";
import { loader as loginLoader } from "../app/routes/auth/login.ts";
import { action as logoutAction } from "../app/routes/auth/logout.ts";
import { loader as homeLoader } from "../app/routes/home.tsx";
import { loader as billingLoader } from "../app/routes/organizations/billing.tsx";
import { humanizeError } from "../app/utils/messages.ts";
import { RequestService } from "../server/http/requests.ts";
import { conflict, forbidden } from "../server/shared/errors.ts";

function setServices(context: RouterContextProvider, runtime: RequestServices) {
  context.set(requestServicesContext, {
    ...runtime,
    requests: new RequestService(
      runtime.sessions,
      runtime.workspace,
      runtime.requestId,
    ),
  });
}
const requests = new RequestService(
  {} as RequestServices["sessions"],
  {} as RequestServices["workspace"],
  "request-123",
);

afterEach(() => vi.restoreAllMocks());

describe("request boundary", () => {
  it.each([loginLoader, callbackLoader])(
    "returns correlated, retryable authentication database failures",
    async (loader) => {
      const context = new RouterContextProvider();
      const fail = async () => {
        throw Object.assign(new Error("private database address"), {
          code: "ECONNREFUSED",
        });
      };
      setServices(context, {
        requestId: "auth-request",
        sessions: { login: fail, callback: fail },
      } as unknown as RequestServices);
      await expect(
        loader({
          request: new Request("http://localhost:17011/auth/login"),
          context,
          params: {},
          url: new URL("http://localhost:17011/auth/login"),
          pattern: "/auth/login",
        }),
      ).rejects.toMatchObject({
        data: { error: "database_unavailable", requestId: "auth-request" },
        init: { status: 503 },
      });
    },
  );

  it("returns a correlated forbidden response for an invalid logout request", async () => {
    const context = new RouterContextProvider();
    setServices(context, {
      requestId: "logout-request",
      sessions: {
        logout: async () => {
          throw forbidden();
        },
      },
    } as unknown as RequestServices);
    const url = new URL("http://localhost:17011/auth/logout");
    const response = await logoutAction({
      request: new Request(url, {
        method: "POST",
        body: new URLSearchParams(),
      }),
      context,
      params: {},
      url,
      pattern: "/auth/logout",
    });
    expect(response).toMatchObject({
      data: {
        ok: false,
        error: "request_verification_failed",
        requestId: "logout-request",
      },
      init: { status: 403 },
    });
  });

  it.each([
    ["user-imani", "aster", [], [], "/organizations/aster/projects"],
    ["user-imani", null, [{ organizationId: "aster" }], [{}], "/invitations"],
    ["user-maya", "aster", [], [], "/organizations/aster/projects"],
    ["user-imani", null, [], [{}], "/support"],
    ["user-lena", null, [], [], "/invitations"],
  ])(
    "lands %s using current workspace facts (%s)",
    async (id, organizationId, memberships, approvals, destination) => {
      const context = new RouterContextProvider();
      setServices(context, {
        requestId: "home-request",
        sessions: {
          optional: async () => ({
            principal: { id },
            expiresAt: Date.now() + 60000,
          }),
        },
        workspace: {
          workspace: async () => ({
            selection: { organizationId, version: 1 },
            memberships,
          }),
          supportApprovals: async () => approvals,
        },
      } as unknown as RequestServices);
      const response = await homeLoader({
        request: new Request("http://localhost:17011/"),
        context,
        params: {},
        url: new URL("http://localhost:17011/"),
        pattern: "/",
      }).catch((error: unknown) => error);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(destination);
    },
  );

  it("keeps invitations workspace navigation unselected after joining", async () => {
    const context = new RouterContextProvider();
    setServices(context, {
      requestId: "invitation-request",
      sessions: {
        optional: async () => ({
          principal: { id: "user-lena" },
          csrfToken: "csrf",
        }),
      },
      workspace: {
        invitationsFor: async () => [],
        workspace: async () => ({
          selection: { organizationId: null, version: 1 },
          memberships: [{ organizationId: "aster" }],
        }),
      },
    } as unknown as RequestServices);
    const result = await rootLoader({
      request: new Request("http://localhost:17011/invitations"),
      context,
      params: {},
      url: new URL("http://localhost:17011/invitations"),
      pattern: "/invitations",
    });
    expect(result.session?.navigationOrganizationId).toBeNull();
    expect(result.session?.activeOrganizationId).toBeNull();
    expect(result.session?.switchKeys).toHaveProperty("aster");
    expect(result.session?.user).not.toHaveProperty("id");
    expect(result.session).not.toHaveProperty("expiresAt");
  });

  it("loads billing without requesting the member directory", async () => {
    const projection = {
      organizationId: "aster",
      plan: "Team",
      seats: 18,
      activeSeats: 2,
      monthlyCents: 360_000,
      version: 1,
    };
    const billing = vi.fn(async () => projection);
    const members = vi.fn(async () => {
      throw new Error("Member directory must not be fetched for billing");
    });
    const context = new RouterContextProvider();
    setServices(context, {
      requestId: "billing-request",
      sessions: { optional: async () => ({ principal: { id: "user-maya" } }) },
      workspace: { billing, members },
    } as unknown as RequestServices);
    const result = await billingLoader({
      request: new Request(
        "http://localhost:17011/organizations/aster/billing",
      ),
      context,
      params: { organizationId: "aster" },
      url: new URL("http://localhost:17011/organizations/aster/billing"),
      pattern: "/organizations/:organizationId/billing",
    });
    expect(result).toEqual({ organizationId: "aster", billing: projection });
    expect(billing).toHaveBeenCalledOnce();
    expect(members).not.toHaveBeenCalled();
  });

  it("keeps specific form recovery messages ahead of the generic fallback", () => {
    expect(humanizeError("invalid_expected_version")).toContain("Reload");
    expect(humanizeError("invalid_idempotency_key")).toContain("Reload");
    expect(humanizeError("invalid_project_name")).toContain("Check the form");
    expect(humanizeError("unknown_error")).toContain("Try again");
  });

  it("parses the exact form version used by actions", () => {
    const form = new FormData();
    form.set("expectedVersion", "2");
    expect(requests.input.version(form)).toBe(2);
    form.set("expectedVersion", "2e0");
    expect(() => requests.input.version(form)).toThrow(
      "invalid_expected_version",
    );
  });

  it("returns correlated conflicts, retryable database outages, and sanitized unknown errors", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [error, code, status] of [
      [conflict("authority_changed"), "authority_changed", 409],
      [
        Object.assign(new Error("private database address"), {
          code: "ECONNREFUSED",
        }),
        "database_unavailable",
        503,
      ],
      ...["EAI_AGAIN", "ENOTFOUND"].map(
        (code) =>
          [
            Object.assign(new Error("private database hostname"), { code }),
            "database_unavailable",
            503,
          ] as const,
      ),
      [new Error("private implementation details"), "request_failed", 500],
    ] as const) {
      const expected = {
        data: { ok: false, error: code, requestId: "request-123" },
        init: { status },
      };
      expect(requests.actionFailure(error)).toMatchObject(expected);
      try {
        requests.loaderFailure(error);
      } catch (failure) {
        expect(failure).toMatchObject({
          data: { error: code, requestId: "request-123" },
          init: { status },
        });
      }
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("preserves redirects instead of turning them into errors", () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
    expect(() => requests.loaderFailure(redirect)).toThrow(redirect);
  });
});
