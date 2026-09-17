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

export async function runStack(mode) {
  const development = mode === "development";
  const resetFixtures = development && process.argv.includes("--reset");
  try {
    await runDevStack({
      prepare: [
        { name: "P4 setup", command: pnpm, args: ["run", "setup"], cwd: root },
        {
          name: "shared identity-provider build",
          command: pnpm,
          args: ["run", "build"],
          cwd: identityRoot,
        },
        ...(resetFixtures
          ? [
              {
                name: "P4 fixture reset",
                command: pnpm,
                args: ["run", "reset"],
                cwd: root,
              },
            ]
          : []),
      ],
      services: () => services(development),
    });
  } catch (error) {
    console.error(
      `P4 ${development ? "development" : "production"} stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    process.exitCode = 1;
  }
}

async function services(development) {
  const configured = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const issuer = configured.P4_ISSUER ?? "http://idp.localhost:4000";
  const idpPort = new URL(issuer).port || "4000";
  const appPort = configured.P4_PORT ?? "3004";
  return [
    {
      name: "shared identity provider",
      command: process.execPath,
      args: ["dist/main.js"],
      cwd: identityRoot,
      health: {
        url: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
        validate: issuerHealth(issuer),
      },
    },
    {
      name: "P4 application",
      command: process.execPath,
      args: development
        ? [
            "node_modules/next/dist/bin/next",
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            appPort,
          ]
        : ["scripts/serve.mjs"],
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: development ? "development" : "production",
      },
      health: {
        url: `http://127.0.0.1:${appPort}/health`,
        validate: serviceHealth("p4-editorial-publishing"),
      },
      timeoutMs: 60_000,
    },
  ];
}
