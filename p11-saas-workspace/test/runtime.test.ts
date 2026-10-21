import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  generation: 1,
  pool: { end: vi.fn(async () => undefined) },
  initialize: vi.fn(async () => undefined),
  oidc: vi.fn(async () => ({})),
  context: undefined as
    | undefined
    | ((request: unknown, response: unknown) => { get(key: unknown): unknown }),
}));

vi.mock("../server/config/environment.ts", () => ({
  loadConfig: () => ({
    databaseUrl: "test://database",
    issuer: "http://localhost:18011",
    baseUrl: "http://localhost:17011",
    sessionSecret: "test-secret",
  }),
}));
vi.mock("../server/data/database.ts", () => ({
  AppDatabase: class {
    pool: typeof state.pool;
    constructor(connection: string | typeof state.pool) {
      this.pool = typeof connection === "string" ? state.pool : connection;
    }
    initialize = state.initialize;
    close() {
      return this.pool.end();
    }
  },
}));
vi.mock("../server/auth/oidc.ts", () => ({ createOidcRuntime: state.oidc }));
vi.mock("../server/workspace/service.ts", () => ({
  WorkspaceService: class {
    generation = state.generation;
  },
}));
vi.mock("@react-router/express", () => ({
  createRequestHandler: (options: { getLoadContext: typeof state.context }) => {
    state.context = options.getLoadContext;
    return (_request: unknown, _response: unknown, next: () => void) => next();
  },
}));

afterEach(async () => {
  const runtime = await import("../server/app.ts");
  await runtime.closeRuntime();
  vi.clearAllMocks();
  vi.resetModules();
});

async function loadServices() {
  await import("../server/app.ts");
  const { requestServicesContext } = await import("../app/context.ts");
  return state
    .context?.(
      {},
      { locals: { requestId: "hmr-request", nonce: "test-nonce" } },
    )
    .get(requestServicesContext) as {
    database: { pool: unknown };
    workspace: { generation: number };
  };
}

it("recreates service adapters after a module reload while sharing connections", async () => {
  const first = await loadServices();
  state.generation = 2;
  vi.resetModules();
  const second = await loadServices();
  expect(second.workspace).not.toBe(first.workspace);
  expect(second.workspace.generation).toBe(2);
  expect(second.database).not.toBe(first.database);
  expect(second.database.pool).toBe(first.database.pool);
  expect(state.initialize).toHaveBeenCalledOnce();
  expect(state.initialize).toHaveBeenCalledWith("http://localhost:18011");
  expect(state.oidc).toHaveBeenCalledOnce();
});

it("gives each request its own workspace adapter while sharing connections", async () => {
  const first = await loadServices();
  const second = await loadServices();
  expect(second.workspace).not.toBe(first.workspace);
  expect(second.database.pool).toBe(first.database.pool);
  expect(state.initialize).toHaveBeenCalledOnce();
  expect(state.oidc).toHaveBeenCalledOnce();
});

it("discards failed initialization so a later module load can retry", async () => {
  state.oidc.mockRejectedValueOnce(new Error("issuer temporarily unavailable"));
  await expect(loadServices()).rejects.toThrow(
    "issuer temporarily unavailable",
  );
  expect(state.pool.end).toHaveBeenCalledOnce();
  vi.resetModules();
  await expect(loadServices()).resolves.toHaveProperty("workspace");
  expect(state.oidc).toHaveBeenCalledTimes(2);
});
