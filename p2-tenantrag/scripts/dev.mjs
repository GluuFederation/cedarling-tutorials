/** Supervise the local P2 IdP and API using the explicitly prepared corpus. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { issuerHealth, runDevStack } from "../../shared/dev-supervisor.mjs";

const root = resolve(import.meta.dirname, "..");
const identityRoot = resolve(root, "../shared/identity-provider");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  await runDevStack({
    prepare: [
      { command: pnpm, args: ["exec", "tsx", "scripts/prepare.ts"], cwd: root },
      { command: pnpm, args: ["build"], cwd: identityRoot },
      {
        command: pnpm,
        args: ["exec", "tsx", "scripts/preflight.ts"],
        cwd: root,
      },
    ],
    services: async () => {
      const configured = parseEnv(
        await readFile(resolve(root, ".env"), "utf8"),
      );
      const env = { ...configured, ...process.env };
      return [
        {
          name: "P2 identity provider",
          command: process.execPath,
          args: [
            `--env-file=${resolve(root, ".local/idp/.env")}`,
            "dist/main.js",
          ],
          cwd: identityRoot,
          health: {
            url: `${env.P2_ISSUER}/.well-known/openid-configuration`,
            validate: issuerHealth(env.P2_ISSUER),
          },
        },
        {
          name: "P2 application",
          command: pnpm,
          args: ["exec", "tsx", "watch", "src/main.ts"],
          cwd: root,
          env,
          health: {
            url: `${env.P2_BASE_URL}/openapi.json`,
            validate: async (response) =>
              response.ok &&
              (await response.json()).info?.title === "P2 TenantRAG API",
          },
        },
      ];
    },
  });
} catch (error) {
  console.error(
    `P2 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}
