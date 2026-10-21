import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  issuerHealth,
  runDevStack,
  serviceHealth,
} from "../../shared/dev-supervisor.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identityRoot = resolve(root, "../shared/identity-provider");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;

try {
  await runDevStack({
    prepare: [
      {
        name: "identity-provider build",
        command: pnpm,
        args: ["run", "build"],
        cwd: identityRoot,
      },
      { name: "P8 setup", command: pnpm, args: ["run", "setup"], cwd: root },
      {
        name: "P8 web build",
        command: pnpm,
        args: ["exec", "vite", "build"],
        cwd: root,
      },
    ],
    services: async () => {
      const configured = parseEnv(
        await readFile(resolve(root, ".env"), "utf8"),
      );
      const issuer = configured.P8_ISSUER ?? "http://localhost:18008";
      return [
        {
          name: "P8 identity provider",
          command: node,
          args: [
            `--env-file=${resolve(root, ".local/idp/.env")}`,
            "dist/main.js",
          ],
          cwd: identityRoot,
          health: {
            url: `http://127.0.0.1:${new URL(issuer).port}/.well-known/openid-configuration`,
            validate: issuerHealth(issuer),
          },
        },
        {
          name: "P8 web build watcher",
          command: pnpm,
          args: ["exec", "vite", "build", "--watch", "--emptyOutDir=false"],
          cwd: root,
        },
        {
          name: "P8 application",
          command: node,
          args: ["--watch", "--env-file=.env", "src/server/main.ts"],
          cwd: root,
          health: {
            url: `http://127.0.0.1:${configured.P8_PORT ?? "17008"}/health`,
            validate: serviceHealth("p8-cedarfile"),
          },
        },
      ];
    },
  });
} catch (error) {
  console.error(
    `P8 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}
