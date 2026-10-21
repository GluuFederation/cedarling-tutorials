import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { AuthStore } from "../src/server/auth/auth-store.ts";
import { loadConfig } from "../src/server/config/environment.ts";
import { GameStore } from "../src/server/data/game-store.ts";
import { GameService } from "../src/server/game/service.ts";

it("closes the development server while a real Vite HMR connection is open", async () => {
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
  let socket: WebSocket | undefined;
  let closing: Promise<void> | undefined;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = new WebSocket(address.replace("http:", "ws:"), "vite-hmr");
    await new Promise<void>((resolve, reject) => {
      socket?.addEventListener("open", () => resolve(), { once: true });
      socket?.addEventListener(
        "error",
        () => reject(new Error("Could not connect to Vite HMR")),
        { once: true },
      );
    });
    closing = app.close();
    const finished = await Promise.race([
      closing.then(() => true),
      delay(2_000).then(() => false),
    ]);
    expect(finished).toBe(true);
  } finally {
    socket?.close();
    await (closing ?? app.close());
    auth.close();
    store.close();
  }
});
