import { rmSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthStore } from "../auth/auth-store.ts";
import { loadConfig, prepareDataDirectory } from "../config/environment.ts";
import { GameStore } from "./game-store.ts";

export async function resetProject(): Promise<void> {
  process.umask(0o077);
  const config = loadConfig();
  const running = await new Promise<boolean>((resolveRunning, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: config.port });
    socket.once("connect", () => {
      socket.destroy();
      resolveRunning(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolveRunning(false);
      else reject(error);
    });
    socket.setTimeout(2_000, () => {
      socket.destroy();
      reject(
        new Error(
          "Could not check whether P14 is running. Stop it before resetting.",
        ),
      );
    });
  });
  if (running)
    throw new Error("Stop P14 before resetting matches and sessions.");
  prepareDataDirectory(config.dataDirectory);
  // Only these application-owned database files are reset. IdP credentials remain.
  for (const database of ["auth.sqlite", "game.sqlite"])
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(resolve(config.dataDirectory, `${database}${suffix}`), {
        force: true,
      });
  new AuthStore(resolve(config.dataDirectory, "auth.sqlite"), config).close();
  new GameStore(resolve(config.dataDirectory, "game.sqlite")).close();
  console.info(
    "P14 matches and sessions reset. Identity-provider credentials are unchanged.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await resetProject();
