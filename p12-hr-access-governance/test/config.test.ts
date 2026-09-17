import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { expect, it } from "vitest";
import { loadConfig, prepareDataDirectory } from "../src/server/config.ts";
import { Database } from "../src/server/database.ts";

it("rejects unsupported modes, remote plain HTTP, and broad storage paths", () => {
  const env = { P12_CLIENT_SECRET: "x".repeat(40) };
  expect(loadConfig({ ...env, P12_AUTHZ_MODE: "embedded" })).toEqual(
    loadConfig(env),
  );
  expect(() =>
    loadConfig({ ...env, P12_ISSUER: "http://outside.example" }),
  ).toThrow();
  expect(() =>
    loadConfig({ ...env, P12_BASE_URL: "https://user:pass@localhost" }),
  ).toThrow();
  expect(() => loadConfig({ ...env, P12_HOST: "192.0.2.1" })).toThrow();
  expect(loadConfig({ ...env, P12_HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
  for (const path of ["/", ".local", ".local/../src", "../p13-student-records"])
    expect(() => loadConfig({ ...env, P12_DATA_DIR: path })).toThrow();
});
it("requires the native HTTP origin to match its loopback listener", () => {
  const env = { P12_CLIENT_SECRET: "x".repeat(40) };
  for (const overrides of [
    { P12_BASE_URL: "http://p12.localhost:4212" },
    { P12_BASE_URL: "https://p12.localhost:3012" },
    { P12_BASE_URL: "https://outside.example:3012" },
    { P12_HOST: "::1" },
    { P12_IDP_PORT: "4001" },
  ])
    expect(() => loadConfig({ ...env, ...overrides })).toThrow();
  expect(
    loadConfig({
      ...env,
      P12_BASE_URL: "http://p12.localhost:4212",
      P12_PORT: "4212",
    }).port,
  ).toBe(4212);
});
it("rejects linked databases and every SQLite sidecar before modifying targets", () => {
  mkdirSync(resolve(".local"), { recursive: true });
  const root = mkdtempSync(resolve(".local/path-test-"));
  try {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      for (const kind of ["dangling", "symbolic", "hard"] as const) {
        const directory = resolve(root, `${kind}${suffix || "-db"}`);
        mkdirSync(directory);
        const target = resolve(root, `${kind}${suffix}-target`);
        if (kind !== "dangling") writeFileSync(target, "untouched");
        const file = resolve(directory, `hr.sqlite${suffix}`);
        if (kind === "hard") linkSync(target, file);
        else symlinkSync(target, file);
        expect(() => prepareDataDirectory(directory)).toThrow(/regular|links/);
        expect(() => new Database(resolve(directory, "hr.sqlite"))).toThrow(
          /regular|links/,
        );
        if (kind === "dangling") expect(existsSync(target)).toBe(false);
        else expect(readFileSync(target, "utf8")).toBe("untouched");
      }
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});
it("setup preserves linked configuration targets and derives registered service ports", () => {
  mkdirSync(resolve(".local"), { recursive: true });
  const root = mkdtempSync(resolve(".local/setup-test-"));
  const project = resolve(root, "project");
  const shared = resolve(root, "shared/identity-provider");
  mkdirSync(project);
  mkdirSync(shared, { recursive: true });
  writeFileSync(
    resolve(shared, ".env"),
    [
      "P12_CLIENT_ID=p12-test",
      `P12_CLIENT_SECRET=${"x".repeat(40)}`,
      "P12_API_RESOURCE=http://p12.localhost:4212/api",
      "IDP_ISSUER=http://idp.localhost:4400",
      "P12_POST_LOGOUT_REDIRECT_URI=http://p12.localhost:4212",
      "P12_REDIRECT_URI=http://p12.localhost:4212/auth/callback",
    ].join("\n"),
  );
  const run = () =>
    spawnSync(process.execPath, [resolve("scripts/setup.ts")], {
      cwd: project,
      encoding: "utf8",
    });
  try {
    const target = resolve(root, "target.env");
    for (const kind of ["dangling", "symbolic", "hard"] as const) {
      if (kind !== "dangling") writeFileSync(target, "UNCHANGED=yes\n");
      if (kind === "hard") linkSync(target, resolve(project, ".env"));
      else symlinkSync(target, resolve(project, ".env"));
      expect(run().status).not.toBe(0);
      if (kind === "dangling") expect(existsSync(target)).toBe(false);
      else expect(readFileSync(target, "utf8")).toBe("UNCHANGED=yes\n");
      rmSync(resolve(project, ".env"));
    }
    writeFileSync(
      resolve(project, ".env"),
      `P12_CLIENT_SECRET=${"stale".repeat(8)}\nP12_LOCAL_NOTE=keep\n`,
    );
    expect(run().status).toBe(0);
    const config = parseEnv(readFileSync(resolve(project, ".env"), "utf8"));
    expect(config.P12_PORT).toBe("4212");
    expect(config.P12_IDP_PORT).toBe("4400");
    expect(config.P12_CLIENT_SECRET).toBe("x".repeat(40));
    expect(config.P12_LOCAL_NOTE).toBe("keep");
  } finally {
    rmSync(root, { recursive: true });
  }
});
it("rejects a symlink inside the owned data path", () => {
  mkdirSync(resolve(".local"), { recursive: true });
  const root = mkdtempSync(resolve(".local/config-test-"));
  try {
    const destination = resolve(root, "real");
    mkdirSync(destination);
    symlinkSync(destination, resolve(root, "link"));
    expect(() => prepareDataDirectory(resolve(root, "link", "nested"))).toThrow(
      "not links",
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});
