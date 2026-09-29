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
        name: "shared identity-provider build",
        command: pnpm,
        args: ["run", "build"],
        cwd: identityRoot,
      },
      { name: "P3 setup", command: pnpm, args: ["run", "setup"], cwd: root },
      { name: "P3 build", command: pnpm, args: ["run", "build"], cwd: root },
    ],
    services,
  });
} catch (error) {
  console.error(
    `P3 development stack stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
}

async function services() {
  const app = parseEnv(await readFile(resolve(root, ".env"), "utf8"));
  const issuer = app.P3_ISSUER ?? "http://localhost:18003";
  const idpPort = new URL(issuer).port || "18003";
  const appPort = app.P3_PORT ?? "17003";
  return [
    {
      name: "P3 identity provider",
      command: node,
      args: [`--env-file=${resolve(root, ".local/idp/.env")}`, "dist/main.js"],
      cwd: identityRoot,
      health: {
        url: `http://127.0.0.1:${idpPort}/.well-known/openid-configuration`,
        validate: issuerHealth(issuer),
      },
    },
    {
      name: "P3 MCP server",
      command: node,
      args: ["dist/src/main.js"],
      cwd: root,
      health: {
        url: `http://127.0.0.1:${appPort}/health`,
        validate: serviceHealth("p3-mcp-capability-governance"),
      },
    },
  ];
}
