import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const app = {
    use: vi.fn(),
    set: vi.fn(),
    disable: vi.fn(),
  };
  const server = { listen: vi.fn(), close: vi.fn() };
  const vite = {
    middlewares: vi.fn(),
    ssrLoadModule: vi.fn(async () => ({ app: vi.fn() })),
    close: vi.fn(async () => undefined),
  };
  return {
    app,
    server,
    vite,
    createServer: vi.fn(() => server),
    createVite: vi.fn(async () => vite),
  };
});

vi.mock("express", () => ({ default: () => state.app }));
vi.mock("node:http", () => ({ createServer: state.createServer }));
vi.mock("vite", () => ({ createServer: state.createVite }));
vi.mock("../server/config/environment.ts", () => ({
  loadConfig: () => ({
    host: "127.0.0.1",
    port: 19011,
    baseUrl: "http://localhost:19011",
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("shares the HTTP listener with development WebSockets and closes Vite on shutdown", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const signalHandlers: (() => Promise<void>)[] = [];
  const on = process.on;
  vi.spyOn(process, "on").mockImplementation((event, handler) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      signalHandlers.push(handler as () => Promise<void>);
      return process;
    }
    return on.call(process, event, handler);
  });

  await import("../server/index.js");
  expect(state.createServer).toHaveBeenCalledWith(state.app);
  expect(state.createVite).toHaveBeenCalledWith({
    server: {
      middlewareMode: true,
      ws: { server: state.server, clientPort: 19011 },
    },
  });
  expect(state.server.listen).toHaveBeenCalledWith(
    19011,
    "127.0.0.1",
    expect.any(Function),
  );
  expect(state.vite.ssrLoadModule).toHaveBeenCalledWith("./server/app.ts");
  expect(signalHandlers).toHaveLength(2);
  await signalHandlers[0]?.();
  expect(state.vite.close).toHaveBeenCalledOnce();
  expect(state.server.close).toHaveBeenCalledOnce();
});
