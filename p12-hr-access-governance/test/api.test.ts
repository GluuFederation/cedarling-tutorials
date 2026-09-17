import { afterEach, expect, it, vi } from "vitest";
import { mutate } from "../src/web/api.ts";

afterEach(() => vi.unstubAllGlobals());

it.each([
  {
    path: "/api/grants",
    body: { employeeId: "cora", days: 1 },
  },
  { path: "/api/grants/g1/approve", body: { version: 1 } },
])(
  "sends $path through the same JSON and session-integrity interface",
  async ({ path, body }) => {
    const result = { data: { id: "g1" }, requestId: "req_mutation" };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(result)));
    vi.stubGlobal("fetch", fetcher);
    expect(await mutate(path, "csrf-example", body)).toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-example",
      },
      body: JSON.stringify(body),
    });
  },
);

it("retains a failed mutation's status and correlation without returning its data", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: { code: "CONFLICT", message: "Refresh and try again." },
          requestId: "req_conflict",
        }),
        { status: 409 },
      ),
  );
  await expect(
    mutate("/api/grants/g1/approve", "csrf-example", { version: 1 }),
  ).rejects.toMatchObject({
    status: 409,
    code: "CONFLICT",
    message: "Refresh and try again. (req_conflict)",
  });
});
