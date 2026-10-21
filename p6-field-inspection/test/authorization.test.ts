import { afterEach, expect, it, vi } from "vitest";
import { fakeAuthorization } from "../src/server/authorization.ts";
import { capabilities } from "../src/shared/capabilities.ts";
import { authorizePresentation } from "../src/web/authorization.ts";

afterEach(() => vi.restoreAllMocks());

it("keeps both adapters permissive and writes one compact line per decision", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const authorization = fakeAuthorization();
  for (const capability of Object.values(capabilities)) {
    const input = {
      capability,
      principalId: "user-elena",
      resourceId: "wo-pump-17",
    };
    expect(authorizePresentation(input)).toBe(true);
    expect(
      await authorization.authorize({ ...input, requestId: "req-test" }),
    ).toBe(true);
    expect(log.mock.calls.slice(-2)).toEqual([
      [
        `P6 browser | FAKE ALLOW (presentation only) | ${capability} | user-elena -> wo-pump-17`,
      ],
      [
        `P6 server | FAKE ALLOW | ${capability} | user-elena -> wo-pump-17 | req-test`,
      ],
    ]);
  }
  expect(log).toHaveBeenCalledTimes(12);
  for (const [line] of log.mock.calls) {
    expect(line).not.toContain("\n");
  }
});

it("logs every batch evaluation, including repeated requests", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const requests = Object.values(capabilities).map((capability) => ({
    requestId: "req-batch",
    capability,
    principalId: "user-elena",
    resourceId: "wo-pump-17",
  }));
  const batch = [...requests, ...requests];
  const decisions = await fakeAuthorization().authorizeMany(batch);

  expect(decisions).toEqual(
    Object.fromEntries(requests.map(({ capability }) => [capability, true])),
  );
  expect(log.mock.calls).toEqual(
    batch.map(({ capability }) => [
      `P6 server | FAKE ALLOW | ${capability} | user-elena -> wo-pump-17 | req-batch`,
    ]),
  );
});
