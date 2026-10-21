import { afterEach, expect, test, vi } from "vitest";
import { request } from "../src/web/api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("browser outcome logs exclude payloads, query data and credentials", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          score: 85,
          internalNote: "private value",
          feedback: "private feedback",
        },
        { headers: { "X-Request-ID": "req-safe" } },
      ),
    ),
  );
  await request("/api/grades/teacher/grade-sam-1?search=private-search", {
    headers: { "X-CSRF-Token": "private-token" },
  });
  expect(log.mock.calls).toEqual([
    ["P13 browser | HTTP 200 | GET /api/grades/teacher/grade-sam-1 | req-safe"],
  ]);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /private|feedback|score|internalNote/,
  );
});
test("failed JSON responses retain a safe error code and request correlation", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "CONFLICT", message: "Reload the grade." },
        { status: 409, headers: { "X-Request-ID": "req-conflict" } },
      ),
    ),
  );
  await expect(
    request("/api/grades/teacher/grade-sam-1"),
  ).rejects.toMatchObject({
    status: 409,
    code: "CONFLICT",
    requestId: "req-conflict",
    message: "Reload the grade.",
  });
});
test("an unreadable successful mutation response has an unconfirmed outcome", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("truncated", {
          status: 200,
          headers: { "X-Request-ID": "req-lost" },
        }),
    ),
  );
  await expect(
    request("/api/grades/grade-sam-1", { method: "PATCH" }),
  ).rejects.toMatchObject({
    status: 502,
    code: "REQUEST_UNCONFIRMED",
    requestId: "req-lost",
  });
});
test("an aborted request is not converted to a recoverable network error", async () => {
  const controller = new AbortController();
  controller.abort();
  const failure = new TypeError("aborted fetch");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw failure;
    }),
  );
  await expect(
    request("/api/session", { signal: controller.signal }),
  ).rejects.toBe(failure);
});
