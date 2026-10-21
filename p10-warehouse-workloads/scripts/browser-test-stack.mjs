import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  canConnect,
  DevSupervisor,
  runCommand,
} from "../../shared/dev-supervisor.mjs";
import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";
import { WORKLOADS, workloadAgentPort } from "../src/shared/catalog.ts";
import { stackServices } from "./stack-services.mjs";

/** Run the same services as native development, with disposable test state. */
export default async function startBrowserTestStack() {
  const root = process.cwd();
  const ports = [
    17010,
    18010,
    3110,
    ...WORKLOADS.map(({ id }) => workloadAgentPort(id)),
  ];
  for (const port of ports) {
    if (await canConnect("127.0.0.1", port))
      throw new Error(
        `P10 browser tests require free port ${port}; stop your own P10 instance first.`,
      );
  }
  await mkdir(join(root, ".local"), { recursive: true });
  const directory = await mkdtemp(join(root, ".local/e2e-"));
  const supervisor = new DevSupervisor();
  const cleanup = async () => {
    await supervisor.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const identityFile = join(directory, "idp.env");
    const identity = ensureProjectIdentity("P10", identityFile);
    const configured = {
      ...identity,
      P10_HOST: "127.0.0.1",
      P10_PORT: "17010",
      P10_BASE_URL: "http://localhost:17010",
      P10_ISSUER: identity.IDP_ISSUER,
      P10_API_HOST: "127.0.0.1",
      P10_API_PORT: "3110",
      P10_DATA_DIR: join(directory, "data"),
      P10_CONTROL_SECRET: randomBytes(32).toString("base64url"),
      P10_WAREHOUSE_API_URL: "http://127.0.0.1:3110",
      P10_TRANSFER_PLANNER_URL: "http://127.0.0.1:3111",
      P10_WAREHOUSE_NORTH_URL: "http://127.0.0.1:3112",
      P10_WAREHOUSE_SOUTH_URL: "http://127.0.0.1:3113",
      P10_INVENTORY_AUDITOR_URL: "http://127.0.0.1:3114",
    };
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    await runCommand(pnpm, ["build"], {
      cwd: resolve(root, "../shared/identity-provider"),
    });
    await runCommand(pnpm, ["build"], { cwd: root });
    const services = stackServices(root, configured, {
      production: true,
      identityFile,
    });
    services[0].env = { ...process.env, ...identity };
    for (const service of services)
      await supervisor.ensure({ ...service, reuseExisting: false });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
