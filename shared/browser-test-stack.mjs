/** Start real browser-test services with private, disposable identity and app data. */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  DevSupervisor,
  canConnect,
  issuerHealth,
  runCommand,
  serviceHealth,
} from "./dev-supervisor.mjs";
import { ensureProjectIdentity } from "./identity-provider/scripts/setup.mjs";
import { projectSettings } from "./identity-provider/src/projects.ts";

export default async function startBrowserTestStack() {
  const root = process.cwd();
  const selector = basename(root).split("-")[0].toUpperCase();
  const project = projectSettings(selector);
  const applicationArgs = {
    P1: ["dist/server/main.js"],
    P4: [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(project.port),
    ],
    P5: ["src/server/main.ts"],
  }[selector];
  if (!applicationArgs)
    throw new Error(`No browser test stack for ${selector}`);
  for (const port of [project.port, project.idpPort]) {
    if (await canConnect("127.0.0.1", port))
      throw new Error(
        `Browser tests require free port ${port}; stop your own project instance first.`,
      );
  }
  await mkdir(join(root, ".local"), { recursive: true });
  const directory = await mkdtemp(join(root, ".local/e2e-"));
  const supervisor = new DevSupervisor();
  const previous = {};
  const cleanup = async () => {
    await supervisor.stop();
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const identityFile = join(directory, "idp.env");
    const identity = ensureProjectIdentity(selector, identityFile);
    const environment = {
      [`${selector}_HOST`]: "127.0.0.1",
      [`${selector}_PORT`]: String(project.port),
      [`${selector}_BASE_URL`]: project.origin,
      [`${selector}_ISSUER`]: project.issuer,
      [`${selector}_API_RESOURCE`]: identity[`${selector}_API_RESOURCE`],
      [`${selector}_CLIENT_ID`]: identity[`${selector}_CLIENT_ID`],
      [`${selector}_CLIENT_SECRET`]: identity[`${selector}_CLIENT_SECRET`],
      [`${selector}_DATA_DIR`]: join(directory, "data"),
      ...(selector === "P1" ? { P1_PROJECT_ROOT: root } : {}),
      [selector === "P4"
        ? "P4_SESSION_SECRET"
        : `${selector}_SESSION_ENCRYPTION_KEY`]:
        randomBytes(32).toString("base64url"),
      NODE_ENV: "production",
    };
    // Playwright passes these same values to its workers, including admin commands.
    for (const [key, value] of Object.entries(environment)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const identityRoot = resolve(root, "../shared/identity-provider");
    await runCommand(pnpm, ["build"], { cwd: identityRoot });
    await runCommand(pnpm, ["build"], { cwd: root });
    await supervisor.ensure({
      name: `${selector} test identity provider`,
      reuseExisting: false,
      command: process.execPath,
      args: [`--env-file=${identityFile}`, "dist/main.js"],
      cwd: identityRoot,
      env: { ...process.env, ...identity },
      health: {
        url: `http://127.0.0.1:${project.idpPort}/.well-known/openid-configuration`,
        validate: issuerHealth(project.issuer),
      },
    });
    await supervisor.ensure({
      name: `${selector} test application`,
      reuseExisting: false,
      command: process.execPath,
      args: applicationArgs,
      cwd: root,
      env: { ...process.env },
      health: {
        url: `http://127.0.0.1:${project.port}/health`,
        validate:
          selector === "P1"
            ? async (response) =>
                response.ok && (await response.json()).status === "ok"
            : serviceHealth(project.id),
      },
      timeoutMs: 60_000,
    });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
