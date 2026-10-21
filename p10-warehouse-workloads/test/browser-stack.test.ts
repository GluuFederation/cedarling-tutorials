import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WORKLOADS, workloadEnvironmentPrefix } from "../src/shared/catalog.ts";

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

import startBrowserTestStack from "../scripts/browser-test-stack.mjs";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.canConnect.mockResolvedValue(false);
  mocks.mkdtemp.mockImplementation(
    async (prefix: string) => `${prefix}fixture`,
  );
  mocks.identity.mockReturnValue({
    IDP_ISSUER: "http://localhost:18010",
    P10_API_RESOURCE: "http://localhost:17010/api",
    ...Object.fromEntries(
      WORKLOADS.flatMap(({ id }) => {
        const prefix = workloadEnvironmentPrefix(id);
        return [
          [`${prefix}_CLIENT_ID`, id],
          [`${prefix}_CLIENT_SECRET`, `${id}-private-test-secret`],
        ];
      }),
    ),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("starts all seven services with private data and isolated workload credentials", async () => {
  vi.stubEnv("P10_DATA_DIR", ".local/learner-data");
  vi.stubEnv("P10_WAREHOUSE_NORTH_CLIENT_SECRET", "learner-secret");
  const root = process.cwd();
  const directory = join(root, ".local/e2e-fixture");
  const cleanup = await startBrowserTestStack();
  expect(mocks.identity).toHaveBeenCalledWith(
    "P10",
    join(directory, "idp.env"),
  );
  expect(mocks.ensure).toHaveBeenCalledTimes(7);
  expect(mocks.ensure.mock.calls[1]?.[0]).toMatchObject({
    args: ["dist/server/api-main.js"],
    env: { P10_DATA_DIR: join(directory, "data") },
  });
  for (const [index, { id }] of WORKLOADS.entries()) {
    const service = mocks.ensure.mock.calls[index + 2]?.[0];
    const prefix = workloadEnvironmentPrefix(id);
    expect(service).toMatchObject({
      args: ["dist/server/agent-main.js", id],
      reuseExisting: false,
      env: {
        [`${prefix}_CLIENT_SECRET`]: `${id}-private-test-secret`,
        P10_SUPERVISED: "1",
      },
    });
    const clientSecrets = Object.keys(service.env).filter(
      (name) => name.endsWith("_CLIENT_SECRET") && name.startsWith("P10_"),
    );
    expect(clientSecrets).toEqual([`${prefix}_CLIENT_SECRET`]);
  }
  expect(
    mocks.runCommand.mock.calls.map(([command, args, options]) => [
      command,
      args,
      options.cwd,
    ]),
  ).toEqual([
    [
      expect.any(String),
      ["build"],
      resolve(root, "../shared/identity-provider"),
    ],
    [expect.any(String), ["build"], root],
  ]);
  await cleanup();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledWith(directory, {
    recursive: true,
    force: true,
  });
  expect(process.env.P10_DATA_DIR).toBe(".local/learner-data");
});

it("refuses an occupied internal port before preparing any state", async () => {
  mocks.canConnect.mockImplementation(
    async (_host: string, port: number) => port === 3113,
  );
  await expect(startBrowserTestStack()).rejects.toThrow(
    "require free port 3113",
  );
  expect(mocks.mkdtemp).not.toHaveBeenCalled();
  expect(mocks.identity).not.toHaveBeenCalled();
  expect(mocks.runCommand).not.toHaveBeenCalled();
  expect(mocks.ensure).not.toHaveBeenCalled();
});

it("stops owned services and removes temporary state after failed startup", async () => {
  mocks.ensure
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("API startup failed"));
  await expect(startBrowserTestStack()).rejects.toThrow("API startup failed");
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledWith(
    join(process.cwd(), ".local/e2e-fixture"),
    { recursive: true, force: true },
  );
});
