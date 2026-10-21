import { afterEach, expect, it, vi } from "vitest";
import { ApiError, loadOrders } from "../src/web/api.ts";

afterEach(() => vi.unstubAllGlobals());

it.each([null, "upstream error", "null", "[]"])(
  "preserves failure status and correlation without a usable JSON envelope (%s)",
  async (body) => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(body, {
          status: 503,
          headers: { "x-request-id": "req-upstream" },
        }),
      ),
    );
    await expect(loadOrders()).rejects.toEqual(
      new ApiError(503, "REQUEST_FAILED", "req-upstream"),
    );
  },
);

it("preserves the bounded server failure envelope", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: "SESSION_EXPIRED" },
          requestId: "req-expired",
        }),
        { status: 401 },
      ),
    ),
  );
  await expect(loadOrders()).rejects.toEqual(
    new ApiError(401, "SESSION_EXPIRED", "req-expired"),
  );
});

it("rejects a malformed successful response", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("invalid JSON")));
  await expect(loadOrders()).rejects.toBeInstanceOf(SyntaxError);
});
