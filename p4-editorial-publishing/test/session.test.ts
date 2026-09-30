import { headers } from "next/headers";
import { afterEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.ts";
import type { OidcRuntime } from "../src/server/oidc.ts";
import { SessionManager } from "../src/server/session.ts";
import { fixture, form } from "./support.ts";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it("distinguishes request verification from an authorization denial", async () => {
  const opened = fixture("riley");
  try {
    const manager = new SessionManager(
      { baseUrl: "http://localhost:17004" } as AppConfig,
      opened.database,
      {} as OidcRuntime,
    );
    vi.spyOn(manager, "require").mockResolvedValue(opened.session);
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        origin: "http://localhost:17004",
        "sec-fetch-site": "same-origin",
      }),
    );
    await expect(
      manager.requireMutation(form({ _csrf: opened.session.csrfToken })),
    ).resolves.toBe(opened.session);
    await expect(
      manager.requireMutation(form({ _csrf: "wrong" })),
    ).rejects.toMatchObject({ status: 403, code: "REQUEST_INTEGRITY_FAILED" });
    vi.mocked(headers).mockResolvedValue(
      new Headers({ origin: "http://attacker.example" }),
    );
    await expect(
      manager.requireMutation(form({ _csrf: opened.session.csrfToken })),
    ).rejects.toMatchObject({
      status: 403,
      code: "REQUEST_INTEGRITY_FAILED",
    });
  } finally {
    opened.cleanup();
  }
});
