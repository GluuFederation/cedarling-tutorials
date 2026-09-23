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
      { name: "P12 setup", command: pnpm, args: ["run", "setup"], cwd: root },
      {
        name: "P12 web build",
        command: pnpm,
        args: ["exec", "vite", "build"],
        cwd: root,
      },
    ],
    services,
  });
} catch (error) {
  console.error(
    `P12 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}

async function services() {
  const configured = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const issuer = configured.P12_ISSUER ?? "http://idp.localhost:4000";
  const idpPort = new URL(issuer).port || "4000";
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
      name: "P12 application",
      command: node,
      args: ["--watch", "--env-file=.env", "src/server/main.ts"],
      cwd: root,
      health: {
        url: `http://127.0.0.1:${configured.P12_PORT ?? "3012"}/health`,
        validate: serviceHealth("p12-hr-access-governance"),
      },
    },
  ];
}
