import { expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.ts";
import { AuthStore } from "../src/server/auth/auth-store.ts";
import { loadConfig } from "../src/server/config/environment.ts";
import { GameStore } from "../src/server/data/game-store.ts";
import { GameService } from "../src/server/game/service.ts";

const vite = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  createServer: vi.fn(),
}));
vi.mock("vite", () => ({ createServer: vite.createServer }));

it("loads Vite configuration natively so Node watch does not observe generated config bundles", async () => {
  vite.createServer.mockResolvedValue({
    middlewares: (_request: unknown, _reply: unknown, next: () => void) =>
      next(),
    close: vite.close,
  });
  const config = loadConfig({
    P14_CLIENT_SECRET: "s".repeat(32),
    P14_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
  });
  const auth = new AuthStore(":memory:", config);
  const store = new GameStore(":memory:");
  const app = await createApp({
    config,
    auth,
    service: new GameService(store),
    development: true,
    oidc: {
      authorizationUrl: async () => new URL("http://localhost:18014/auth"),
      exchange: async () => ({
        subject: "dina",
        accessToken: "private",
        expiresAt: Date.now() + 60_000,
      }),
    },
  });
  try {
    await app.ready();
    expect(vite.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        configLoader: "native",
        server: { middlewareMode: true, hmr: { server: app.server } },
      }),
    );
  } finally {
    await app.close();
    auth.close();
    store.close();
  }
  expect(vite.close).toHaveBeenCalledOnce();
});
