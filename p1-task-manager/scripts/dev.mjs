/** Prepare and supervise P1's IdP, browser build watcher, and API together. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { issuerHealth, runDevStack } from "../../shared/dev-supervisor.mjs";
import { loadConfig } from "../src/server/config.ts";

const root = resolve(import.meta.dirname, "..");
const identityRoot = resolve(root, "../shared/identity-provider");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  await runDevStack({
    prepare: [
      { command: pnpm, args: ["run", "setup"], cwd: root },
      { command: pnpm, args: ["build"], cwd: identityRoot },
      { command: pnpm, args: ["exec", "vite", "build"], cwd: root },
    ],
    services: async () => {
      const configured = parseEnv(
        await readFile(resolve(root, ".env"), "utf8"),
      );
      const env = { ...configured, ...process.env };
      const config = loadConfig(env, root);
      return [
        {
          name: "P1 identity provider",
          command: process.execPath,
          args: [
            `--env-file=${resolve(root, ".local/idp/.env")}`,
            "dist/main.js",
          ],
          cwd: identityRoot,
          health: {
            url: `${config.issuer}/.well-known/openid-configuration`,
            validate: issuerHealth(config.issuer),
          },
        },
        {
          name: "P1 browser watcher",
          command: pnpm,
          args: ["exec", "vite", "build", "--watch"],
          cwd: root,
        },
        {
          name: "P1 application",
          command: pnpm,
          args: ["exec", "tsx", "watch", "src/server/main.ts"],
          cwd: root,
          env,
          health: {
            url: `${config.baseUrl}/health`,
            validate: async (response) =>
              response.ok && (await response.json()).status === "ok",
          },
        },
      ];
    },
  });
} catch (error) {
  console.error(
    `P1 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}
