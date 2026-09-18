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
const resetFixtures = process.argv.includes("--reset");

try {
  await runDevStack({
    prepare: [
      {
        name: "shared identity-provider setup",
        command: pnpm,
        args: ["run", "setup"],
        cwd: identityRoot,
      },
      {
        name: "shared identity-provider build",
        command: pnpm,
        args: ["run", "build"],
        cwd: identityRoot,
      },
      { name: "P11 setup", command: pnpm, args: ["run", "setup"], cwd: root },
      ...(resetFixtures
        ? [
            {
              name: "P11 fixture reset",
              command: pnpm,
              args: ["run", "reset"],
              cwd: root,
            },
          ]
        : []),
    ],
    services,
  });
} catch (error) {
  console.error(
    `P11 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}

async function services() {
  const configured = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const issuer = configured.P11_ISSUER ?? "http://idp.localhost:4000";
  const idpPort = new URL(issuer).port || "4000";
  const appPort = configured.P11_PORT ?? "3011";
  return [
    {
      name: "shared identity provider",
      command: node,
      args: ["dist/main.js"],
      cwd: identityRoot,
      health: {
        url: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
        validate: issuerHealth(issuer),
      },
    },
    {
      name: "P11 application",
      command: node,
      args: ["--env-file=.env", "--conditions", "development", "server.js"],
      cwd: root,
      env: { ...process.env, NODE_ENV: "development" },
      health: {
        url: `http://127.0.0.1:${appPort}/health`,
        validate: serviceHealth("p11-saas-workspace"),
      },
      timeoutMs: 60_000,
    },
  ];
}
