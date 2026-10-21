import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { AuthStore } from "./auth/auth-store.ts";
import { createOidc } from "./auth/oidc.ts";
import { loadConfig, prepareDataDirectory } from "./config/environment.ts";
import { GameStore } from "./data/game-store.ts";
import { GameService } from "./game/service.ts";

process.umask(0o077);
const config = loadConfig();
prepareDataDirectory(config.dataDirectory);
const auth = new AuthStore(
  resolve(config.dataDirectory, "auth.sqlite"),
  config,
);
const store = new GameStore(resolve(config.dataDirectory, "game.sqlite"));
let closing = false;
try {
  const app = await createApp({
    config,
    auth,
    oidc: await createOidc(config),
    service: new GameService(store),
    development: process.env.NODE_ENV === "development",
  });
  const stop = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
    } finally {
      auth.close();
      store.close();
    }
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await app.listen({ host: config.host, port: config.port });
  console.info("P14 baseline: FAKE ALLOW; Cedarling is not called.");
  console.info(`P14 Capital District listening at ${config.baseUrl}`);
} catch (error) {
  if (!closing) {
    auth.close();
    store.close();
  }
  throw error;
}
