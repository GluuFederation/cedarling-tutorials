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
          IDP_PROJECT: "P6",
          IDP_HOST: "127.0.0.1",
          IDP_PORT: String(address.port),
          IDP_ISSUER: `http://127.0.0.1:${address.port}`,
          P6_CLIENT_SECRET: p6Secret,
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
