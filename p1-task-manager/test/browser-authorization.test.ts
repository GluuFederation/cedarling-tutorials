/** @vitest-environment jsdom */
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AuthorizationEnvelope } from "../src/shared/authorization";
import type { Task, User } from "../src/web/types";

const sdk = vi.hoisted(() => ({ initFromArchiveBytes: vi.fn() }));
vi.mock("@janssenproject/cedarling_wasm", () => sdk);

import {
  authorizePresentation,
  closeBrowserAuthorization,
} from "../src/web/authorization-trace";

const bytes = new Uint8Array([1, 2, 3]);
const digest = createHash("sha256").update(bytes).digest("hex");
const user: User = {
  id: "user-mina",
  name: "Mina Okafor",
  tenantId: "tenant-a",
  role: "owner",
  assuranceLevel: 2,
};
const task: Task = {
  id: "task-a-brief",
  tenantId: "tenant-a",
  ownerId: "user-mina",
  assigneeId: "user-alex",
  title: "Prepare launch brief",
  description: "",
  status: "in-progress",
  version: 1,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

function envelope(): AuthorizationEnvelope {
  return {
    uiPrincipal: user,
    ceiling: {
      tenant: { create: true },
      tasks: { [task.id]: { view: true, edit: true } },
    },
    policy: {
      release: "p1@1.0.0",
      storeId: "p1",
      version: "1.0.0",
      sha256: digest,
      url: `/policy-store/${digest}.cjar`,
    },
    subjectEpoch: "epoch-user-mina",
    resourceVersions: { [task.id]: 1 },
    evaluatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function cedarling(decisions: readonly boolean[]) {
  return {
    authorizeUnsignedBatch: vi.fn(async () => ({
      results: decisions.map((decision, index) => ({
        is_ok: true,
        unwrap: () => ({
          decision,
          request_id: `request-${String(index)}`,
          response: { diagnostics: { errors: [], reason: [] } },
        }),
      })),
    })),
    getLogsByRequestId: vi.fn((_requestId: string): object[] => []),
    shutDown: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes, { status: 200 })),
  );
});

afterEach(async () => {
  await closeBrowserAuthorization();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("P1 browser Cedarling boundary", () => {
  test("intersects unsigned decisions with the server ceiling", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const runtime = cedarling([false, true, false]);
    const log = {
      action: 'Task::Action::"View"',
      decision: "ALLOW",
      diagnostics: {
        reason: [{ id: "browser-view-related-task" }],
        errors: [],
      },
    };
    runtime.getLogsByRequestId.mockImplementation((requestId) =>
      requestId === "request-1" ? [log] : [],
    );
    sdk.initFromArchiveBytes.mockResolvedValue(runtime);

    const result = await authorizePresentation({
      envelope: envelope(),
      tasks: [task],
      user,
    });

    expect(result).toEqual({
      stale: false,
      ceiling: {
        tenant: { create: false },
        tasks: { [task.id]: { view: true, edit: false } },
      },
    });
    expect(sdk.initFromArchiveBytes).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      'P1 browser | ALLOW | Task::Action::"View"',
      log,
    );
    expect(sdk.initFromArchiveBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        CEDARLING_JWT_SIG_VALIDATION: "disabled",
        CEDARLING_JWT_STATUS_VALIDATION: "disabled",
        CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
      }),
      bytes,
    );
  });

  test("uses a current server ceiling when browser initialization fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.initFromArchiveBytes.mockRejectedValue(
      new Error("browser unavailable: private-error-detail"),
    );
    const current = envelope();

    expect(
      await authorizePresentation({ envelope: current, tasks: [task], user }),
    ).toEqual({ stale: false, ceiling: current.ceiling });
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      "P1 browser | authorization unavailable; using the current server ceiling",
    );
    warning.mockRestore();
  });

  test("skips browser evaluation when the server ceiling denies every control", async () => {
    const current = envelope();
    const denied = {
      ...current,
      ceiling: {
        tenant: { create: false },
        tasks: { [task.id]: { view: false, edit: false } },
      },
    };

    expect(
      await authorizePresentation({ envelope: denied, tasks: [task], user }),
    ).toEqual({ stale: false, ceiling: denied.ceiling });
    expect(sdk.initFromArchiveBytes).not.toHaveBeenCalled();
  });

  test("rejects an envelope whose resource version is stale", async () => {
    const result = await authorizePresentation({
      envelope: envelope(),
      tasks: [{ ...task, version: 2 }],
      user,
    });

    expect(result).toEqual({ stale: true, ceiling: { tasks: {} } });
    expect(sdk.initFromArchiveBytes).not.toHaveBeenCalled();
  });
});
