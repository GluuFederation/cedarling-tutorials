import { spawn as spawnProcess } from "node:child_process";
import { once } from "node:events";
import { connect as connectSocket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const requestTimeoutMs = 1_000;

export async function probeHttp(health, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(health.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    return "missing";
  }
  try {
    return (await health.validate(response)) ? "ready" : "incompatible";
  } catch {
    return "incompatible";
  }
}

export function canConnect(host, port, timeoutMs = requestTimeoutMs) {
  return new Promise((resolve) => {
    const socket = connectSocket({ host, port });
    const finish = (available) => {
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function checkDependencies(
  dependencies,
  checks = { connect: canConnect, fetch },
) {
  const missing = [];
  for (const dependency of dependencies) {
    const available =
      dependency.kind === "tcp"
        ? await checks.connect(dependency.host, dependency.port)
        : (await probeHttp(dependency, checks.fetch)) === "ready";
    if (!available) {
      missing.push(
        dependency.kind === "tcp"
          ? `${dependency.name} (${dependency.host}:${dependency.port})`
          : dependency.name,
      );
    }
  }
  if (missing.length) {
    throw new Error(`Unavailable dependencies: ${missing.join(", ")}`);
  }
}

export function resolveCommand(
  command,
  args,
  {
    platform = process.platform,
    commandShell = process.env.ComSpec ?? "cmd.exe",
  } = {},
) {
  if (platform === "win32" && /\.(?:bat|cmd)$/i.test(command)) {
    return {
      command: commandShell,
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export async function runCommand(command, args, options = {}) {
  const resolved = resolveCommand(command, args);
  const child = spawnProcess(resolved.command, resolved.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  const result = await Promise.race([
    once(child, "exit").then(([code, signal]) => ({ code, signal })),
    once(child, "error").then(([error]) => ({ error })),
  ]);
  if (result.error) {
    throw new Error(
      `${options.name ?? command} could not start: ${result.error.message}`,
    );
  }
  const { code, signal } = result;
  if (code !== 0) {
    throw new Error(
      `${options.name ?? command} failed${
        signal ? ` after ${signal}` : ` with exit code ${code}`
      }`,
    );
  }
}

export class DevSupervisor {
  #dependencies;
  #owned = [];
  #failure;
  #rejectFailure;
  #stopping = false;

  constructor(dependencies = {}) {
    this.#dependencies = {
      fetch: dependencies.fetch ?? fetch,
      spawn: dependencies.spawn ?? spawnProcess,
      delay: dependencies.delay ?? delay,
      log: dependencies.log ?? console.info,
    };
    this.#failure = new Promise((_, reject) => {
      this.#rejectFailure = reject;
    });
    this.#failure.catch(() => undefined);
  }

  get ownedCount() {
    return this.#owned.length;
  }

  async ensure(service) {
    const initial = await probeHttp(service.health, this.#dependencies.fetch);
    if (initial === "ready") {
      this.#dependencies.log(
        `Reusing ${service.name} at ${service.health.url}`,
      );
      return;
    }
    if (initial === "incompatible") {
      throw new Error(
        `${service.name} cannot start: ${service.health.url} is owned by an incompatible service. Stop only that listener or configure a free port.`,
      );
    }

    const child = this.#dependencies.spawn(service.command, service.args, {
      cwd: service.cwd,
      env: service.env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    this.#owned.push(child);
    let startupFailure;
    child.once("error", (error) => {
      if (!this.#stopping) {
        startupFailure = new Error(
          `${service.name} could not start: ${error.message}`,
        );
        this.#rejectFailure(startupFailure);
      }
    });
    child.once("exit", (code, signal) => {
      if (!this.#stopping) {
        startupFailure = new Error(
          `${service.name} exited${
            signal ? ` after ${signal}` : ` with exit code ${code}`
          }`,
        );
        this.#rejectFailure(startupFailure);
      }
    });

    const deadline = Date.now() + (service.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      if (startupFailure) throw startupFailure;
      if (child.exitCode !== null) {
        throw new Error(`${service.name} exited before becoming ready`);
      }
      await this.#dependencies.delay(200);
      const state = await probeHttp(service.health, this.#dependencies.fetch);
      if (state === "ready") {
        this.#dependencies.log(`${service.name} is ready`);
        return;
      }
      if (state === "incompatible") {
        throw new Error(
          `${service.name} health check returned an incompatible response at ${service.health.url}`,
        );
      }
    }
    throw new Error(
      `${service.name} did not become ready at ${service.health.url}`,
    );
  }

  async wait() {
    if (this.#owned.length) await this.#failure;
  }

  async stop() {
    if (this.#stopping) return;
    this.#stopping = true;
    const children = [...this.#owned].reverse();
    for (const child of children) {
      if (child.exitCode !== null || !child.pid) continue;
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode !== null) return;
        await Promise.race([once(child, "exit"), delay(5_000)]);
      }),
    );
  }
}

export async function runDevStack({ prepare = [], services }) {
  for (const command of prepare) {
    await runCommand(command.command, command.args, command);
  }
  const configuredServices =
    typeof services === "function" ? await services() : services;
  const supervisor = new DevSupervisor();
  let resolveSignal;
  const signalReceived = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => resolveSignal(signal);
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    for (const service of configuredServices) await supervisor.ensure(service);
    if (supervisor.ownedCount) {
      await Promise.race([supervisor.wait(), signalReceived]);
    }
  } finally {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
    await supervisor.stop();
  }
}

export const serviceHealth = (service, status = "ok") => async (response) => {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("application/json")
  )
    return false;
  const body = await response.json();
  return body.status === status && body.service === service;
};

export const issuerHealth = (issuer) => async (response) =>
  response.ok &&
  response.headers.get("content-type")?.startsWith("application/json") &&
  (await response.json()).issuer === issuer;
