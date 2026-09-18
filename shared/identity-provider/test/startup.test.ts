import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("identity-provider startup", () => {
  it("exits non-zero with a bounded message when the port is occupied", async () => {
    const occupied = createServer();
    servers.push(occupied);
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    const address = occupied.address();
    if (!address || typeof address === "string") {
      throw new Error("Test listener did not expose a TCP port");
    }

    const p6Secret = "a".repeat(32);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/main.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          IDP_PROFILE: "default",
          IDP_HOST: "127.0.0.1",
          IDP_PORT: String(address.port),
          IDP_ISSUER: `http://127.0.0.1:${address.port}`,
          P1_CLIENT_SECRET: "p1".repeat(16),
          P4_CLIENT_SECRET: "p4".repeat(16),
          P5_CLIENT_SECRET: "p5".repeat(16),
          P6_CLIENT_SECRET: p6Secret,
          P7_CLIENT_SECRET: "p7".repeat(16),
          P8_CLIENT_SECRET: "p8".repeat(16),
          P9_CLIENT_SECRET: "p9".repeat(16),
          P10_TRANSFER_PLANNER_CLIENT_SECRET: "planner".repeat(5),
          P10_WAREHOUSE_NORTH_CLIENT_SECRET: "north".repeat(7),
          P10_WAREHOUSE_SOUTH_CLIENT_SECRET: "south".repeat(7),
          P10_INVENTORY_AUDITOR_CLIENT_SECRET: "auditor".repeat(5),
          P11_CLIENT_SECRET: "p11".repeat(11),
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Identity provider could not listen on 127.0.0.1:${address.port}: address already in use`,
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(p6Secret);
  }, 15_000);
});
