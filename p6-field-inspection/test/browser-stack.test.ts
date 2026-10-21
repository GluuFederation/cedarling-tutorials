import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  canConnect: vi.fn(),
  runCommand: vi.fn(),
  ensure: vi.fn(),
  stop: vi.fn(),
  identity: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  mkdtemp: mocks.mkdtemp,
  rm: mocks.rm,
}));
vi.mock("../../shared/dev-supervisor.mjs", () => ({
  canConnect: mocks.canConnect,
  runCommand: mocks.runCommand,
  issuerHealth: () => () => true,
  serviceHealth: () => () => true,
  DevSupervisor: class {
    ensure = mocks.ensure;
    stop = mocks.stop;
  },
}));
vi.mock("../../shared/identity-provider/scripts/setup.mjs", () => ({
  ensureProjectIdentity: mocks.identity,
}));

import startBrowserTestStack from "../../shared/browser-test-stack.mjs";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.canConnect.mockResolvedValue(false);
  mocks.mkdtemp.mockImplementation(
    async (prefix: string) => `${prefix}fixture`,
  );
  mocks.identity.mockImplementation((project: string) => ({
    [`${project}_API_RESOURCE`]: "http://localhost/api",
    [`${project}_CLIENT_ID`]: "test-client",
    [`${project}_CLIENT_SECRET`]: "disposable-test-secret",
  }));
});
afterEach(() => vi.restoreAllMocks());

it.each([
  ["p1-task-manager", "P1", 17001, "dist/server/main.js", "health"],
  [
    "p4-editorial-publishing",
    "P4",
    17004,
    "node_modules/next/dist/bin/next",
    "health",
  ],
  ["p5-dataguard", "P5", 17005, "src/server/main.ts", "health"],
  ["p6-field-inspection", "P6", 17006, "dist/server/main.js", "healthz"],
  ["p15-marketplace", "P15", 17015, "dist/server/main.js", "health"],
] as const)(
  "isolates %s and preserves its startup contract",
  async (name, selector, port, entry, health) => {
    const root = resolve("..", name);
    const dataKey = `${selector}_DATA_DIR`;
    const previous = process.env[dataKey];
    const previousMode = process.env.NODE_ENV;
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const cleanup = await startBrowserTestStack();
    try {
      expect(mocks.canConnect.mock.calls).toEqual([
        ["127.0.0.1", port],
        ["127.0.0.1", port + 1000],
      ]);
      expect(mocks.identity).toHaveBeenCalledWith(
        selector,
        join(root, ".local/e2e-fixture/idp.env"),
      );
      expect(mocks.ensure).toHaveBeenLastCalledWith(
        expect.objectContaining({
          reuseExisting: false,
          command: process.execPath,
          args:
            selector === "P4"
              ? [
                  entry,
                  "start",
                  "--hostname",
                  "127.0.0.1",
                  "--port",
                  String(port),
                ]
              : [entry],
          env: expect.objectContaining({
            [dataKey]: join(root, ".local/e2e-fixture/data"),
          }),
          health: expect.objectContaining({
            url: `http://127.0.0.1:${port}/${health}`,
          }),
        }),
      );
      expect(mocks.runCommand.mock.calls.map((call) => call[1])).toEqual([
        ["build"],
        ["build"],
      ]);
    } finally {
      await cleanup();
    }
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith(join(root, ".local/e2e-fixture"), {
      recursive: true,
      force: true,
    });
    expect(process.env[dataKey]).toBe(previous);
    expect(process.env.NODE_ENV).toBe(previousMode);
  },
);

it("cleans its temporary stack and restores environment after a startup failure", async () => {
  const root = resolve("../p6-field-inspection");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  const previous = process.env.P6_DATA_DIR;
  mocks.ensure
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("app failed"));
  await expect(startBrowserTestStack()).rejects.toThrow("app failed");
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledWith(join(root, ".local/e2e-fixture"), {
    recursive: true,
    force: true,
  });
  expect(process.env.P6_DATA_DIR).toBe(previous);
});

it("refuses occupied ports before creating credentials, data, or processes", async () => {
  vi.spyOn(process, "cwd").mockReturnValue(resolve("../p6-field-inspection"));
  mocks.canConnect.mockResolvedValue(true);
  await expect(startBrowserTestStack()).rejects.toThrow(
    "require free port 17006",
  );
  expect(mocks.mkdtemp).not.toHaveBeenCalled();
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.ensure).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalled();
});
