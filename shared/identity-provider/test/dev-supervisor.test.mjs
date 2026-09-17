import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  DevSupervisor,
  checkDependencies,
  probeHttp,
  resolveCommand,
} from "../../dev-supervisor.mjs";

const response = (body = { status: "ok" }) => ({
  ok: true,
  headers: { get: () => "application/json" },
  json: async () => body,
});

class Child extends EventEmitter {
  exitCode = null;
  pid = 123;
  kill = vi.fn(() => true);
}

describe("native development supervision", () => {
  it("uses the Windows command processor only for command shims", () => {
    expect(
      resolveCommand("pnpm.cmd", ["run", "setup"], {
        platform: "win32",
        commandShell: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd", "run", "setup"],
    });
    expect(
      resolveCommand("node", ["app.js"], {
        platform: "win32",
        commandShell: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({ command: "node", args: ["app.js"] });
    expect(
      resolveCommand("pnpm", ["run", "setup"], { platform: "linux" }),
    ).toEqual({ command: "pnpm", args: ["run", "setup"] });
  });

  it("distinguishes a missing listener from an incompatible occupied port", async () => {
    expect(
      await probeHttp(
        { url: "http://example.test/health", validate: async () => true },
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      ),
    ).toBe("missing");
    expect(
      await probeHttp(
        { url: "http://example.test/health", validate: async () => false },
        vi.fn().mockResolvedValue(response()),
      ),
    ).toBe("incompatible");
    expect(
      await probeHttp(
        {
          url: "http://example.test/health",
          validate: async (response) => (await response.json()).status === "ok",
        },
        vi.fn().mockResolvedValue({
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => {
            throw new SyntaxError("invalid JSON");
          },
        }),
      ),
    ).toBe("incompatible");
  });

  it("reuses a healthy service without creating an owned child", async () => {
    const spawn = vi.fn();
    const supervisor = new DevSupervisor({
      fetch: vi.fn().mockResolvedValue(response()),
      spawn,
      delay: vi.fn(),
      log: vi.fn(),
    });
    await supervisor.ensure({
      name: "application",
      command: "pnpm",
      args: ["start"],
      cwd: "/tmp",
      health: {
        url: "http://example.test/health",
        validate: async (response) => (await response.json()).status === "ok",
      },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(supervisor.ownedCount).toBe(0);
  });

  it("fails when a child exits before it becomes healthy", async () => {
    const child = new Child();
    const supervisor = new DevSupervisor({
      fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      spawn: vi.fn(() => child),
      delay: vi.fn(async () => {
        child.exitCode = 1;
        child.emit("exit", 1, null);
      }),
      log: vi.fn(),
    });
    await expect(
      supervisor.ensure({
        name: "application",
        command: "pnpm",
        args: ["start"],
        cwd: "/tmp",
        health: {
          url: "http://example.test/health",
          validate: async () => true,
        },
        timeoutMs: 20,
      }),
    ).rejects.toThrow("application exited with exit code 1");
  });

  it("reports a missing runtime without waiting for the health timeout", async () => {
    const child = new Child();
    const supervisor = new DevSupervisor({
      fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      spawn: vi.fn(() => child),
      delay: vi.fn(async () => {
        child.emit("error", new Error("spawn deno ENOENT"));
      }),
      log: vi.fn(),
    });
    await expect(
      supervisor.ensure({
        name: "application",
        command: "deno",
        args: ["run", "main.ts"],
        cwd: "/tmp",
        health: {
          url: "http://example.test/health",
          validate: async () => true,
        },
        timeoutMs: 20,
      }),
    ).rejects.toThrow("application could not start: spawn deno ENOENT");
  });

  it("reports every unavailable dependency in one actionable message", async () => {
    await expect(
      checkDependencies(
        [
          { kind: "tcp", name: "PostgreSQL", host: "127.0.0.1", port: 5434 },
          {
            kind: "http",
            name: "identity provider",
            url: "http://idp.localhost:4000/health",
            validate: async () => true,
          },
        ],
        {
          connect: vi.fn().mockResolvedValue(false),
          fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
        },
      ),
    ).rejects.toThrow("PostgreSQL (127.0.0.1:5434), identity provider");
  });
});
