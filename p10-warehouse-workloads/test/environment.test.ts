import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exists: vi.fn(), load: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: mocks.exists }));
vi.mock("node:process", () => ({ loadEnvFile: mocks.load }));

import { loadLocalEnvironment } from "../src/server/environment.ts";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exists.mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

it("does not import other workloads' credentials into supervised services", () => {
  vi.stubEnv("P10_SUPERVISED", "1");
  loadLocalEnvironment();
  expect(mocks.exists).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});

it("retains local environment loading for standalone commands", () => {
  vi.stubEnv("P10_SUPERVISED", undefined);
  loadLocalEnvironment();
  expect(mocks.load).toHaveBeenCalledWith(resolve(".env"));
});

it("leaves explicit environment and --env-file configuration alone when no local file exists", () => {
  vi.stubEnv("P10_SUPERVISED", undefined);
  mocks.exists.mockReturnValue(false);
  loadLocalEnvironment();
  expect(mocks.load).not.toHaveBeenCalled();
});
