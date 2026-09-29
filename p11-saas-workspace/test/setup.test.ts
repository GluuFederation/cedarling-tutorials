// Exercises setup's real environment files while isolating Docker and PostgreSQL.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  docker: vi.fn(),
  connect: vi.fn(),
  migrate: vi.fn(),
  query: vi.fn(),
  seed: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: dependencies.docker }));
vi.mock("../src/server/database.ts", () => ({
  AppDatabase: class {
    constructor(url: string) {
      dependencies.connect(url);
    }
    pool = { query: dependencies.query };
    migrate = dependencies.migrate;
    seed = dependencies.seed;
    close = dependencies.close;
  },
}));

let directory: string;
const customUrl = "postgresql://learner:example@localhost:15435/workspace";
const defaultUrl = "postgresql://p11:p11@127.0.0.1:5435/p11";
const setup = async () => {
  vi.resetModules();
  await import("../scripts/setup.ts");
};
const environment = () =>
  parseEnv(readFileSync(join(directory, ".env"), "utf8"));

beforeEach(() => {
  vi.resetAllMocks();
  directory = mkdtempSync(join(tmpdir(), "p11-setup-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.stubEnv("P11_DATABASE_URL", undefined);
  dependencies.docker.mockReturnValue({ status: 0 });
  dependencies.query.mockResolvedValue({ rows: [{ count: "0" }] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it("starts the default Compose database and initializes empty fixtures", async () => {
  await setup();
  expect(environment().P11_DATABASE_URL).toBe(defaultUrl);
  expect(dependencies.docker).toHaveBeenCalledWith(
    "docker",
    ["compose", "up", "-d", "--wait", "postgres"],
    { cwd: directory, stdio: "inherit" },
  );
  expect(dependencies.connect).toHaveBeenCalledWith(defaultUrl);
  expect(dependencies.migrate).toHaveBeenCalledOnce();
  expect(dependencies.seed).toHaveBeenCalledOnce();
  expect(dependencies.close).toHaveBeenCalledOnce();
});

it("persists a shell database override and preserves credentials and existing data on rerun", async () => {
  writeFileSync(join(directory, ".env"), `P11_DATABASE_URL=${defaultUrl}\n`);
  vi.stubEnv("P11_DATABASE_URL", customUrl);
  await setup();
  const first = environment();
  expect(first.P11_DATABASE_URL).toBe(customUrl);
  expect(dependencies.connect).toHaveBeenLastCalledWith(customUrl);
  vi.stubEnv("P11_DATABASE_URL", undefined);
  dependencies.query.mockResolvedValue({ rows: [{ count: "4" }] });
  await setup();
  expect(environment()).toEqual(first);
  expect(dependencies.connect).toHaveBeenLastCalledWith(customUrl);
  expect(dependencies.docker).not.toHaveBeenCalled();
  expect(dependencies.seed).toHaveBeenCalledOnce();
});

it("uses an existing custom database without Docker", async () => {
  writeFileSync(join(directory, ".env"), `P11_DATABASE_URL=${customUrl}\n`);
  await setup();
  expect(environment().P11_DATABASE_URL).toBe(customUrl);
  expect(dependencies.connect).toHaveBeenCalledWith(customUrl);
  expect(dependencies.docker).not.toHaveBeenCalled();
});

it("propagates a custom database failure and closes the pool without a Docker fallback", async () => {
  vi.stubEnv("P11_DATABASE_URL", customUrl);
  dependencies.migrate.mockRejectedValue(new Error("connection refused"));
  await expect(setup()).rejects.toThrow("connection refused");
  expect(dependencies.connect).toHaveBeenCalledWith(customUrl);
  expect(dependencies.docker).not.toHaveBeenCalled();
  expect(dependencies.seed).not.toHaveBeenCalled();
  expect(dependencies.close).toHaveBeenCalledOnce();
});

it("stops before migration when the default Compose database cannot start", async () => {
  dependencies.docker.mockReturnValue({ status: 1 });
  await expect(setup()).rejects.toThrow("P11 PostgreSQL could not start");
  expect(dependencies.connect).not.toHaveBeenCalled();
});
