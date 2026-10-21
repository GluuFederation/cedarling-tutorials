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
try {
  await runDevStack({
    prepare: [
      {
        name: "identity-provider build",
        command: pnpm,
        args: ["run", "build"],
        cwd: identityRoot,
      },
      { name: "P14 setup", command: pnpm, args: ["run", "setup"], cwd: root },
    ],
    services: async () => {
      const configured = parseEnv(
        await readFile(resolve(root, ".env"), "utf8"),
      );
      const issuer = configured.P14_ISSUER ?? "http://localhost:18014";
      return [
        {
          name: "P14 identity provider",
          command: process.execPath,
          args: [
            `--env-file=${resolve(root, ".local/idp/.env")}`,
            "dist/main.js",
          ],
          cwd: identityRoot,
          health: {
            url: `http://127.0.0.1:${new URL(issuer).port || "18014"}/.well-known/openid-configuration`,
            validate: issuerHealth(issuer),
          },
        },
        {
          name: "P14 application",
          command: process.execPath,
          args: ["--env-file=.env", "--watch", "src/server/main.ts"],
          cwd: root,
          env: { ...process.env, NODE_ENV: "development" },
          health: {
            url: `http://127.0.0.1:${configured.P14_PORT ?? "17014"}/healthz`,
            validate: serviceHealth("p14-capital-district"),
          },
        },
      ];
    },
  });
} catch (error) {
  console.error(
    `P14 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}
