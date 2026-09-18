import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { setupProject } from "../scripts/setup.ts";
import { containedDataDir, loadConfig } from "../src/server/config.ts";
import { SchoolDatabase } from "../src/server/database.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test("configuration rejects unsupported authorization, non-loopback origins and inconsistent ports", () => {
  const defaults = {
    P13_CLIENT_SECRET: "temporary-test-secret-at-least-32-characters",
  };
  expect(loadConfig({ ...defaults, P13_AUTHZ_MODE: "embedded" })).toEqual(
    loadConfig(defaults),
  );
  expect(() => loadConfig({ ...defaults, P13_HOST: "192.0.2.1" })).toThrow(
    "local or container",
  );
  expect(loadConfig({ ...defaults, P13_HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
  expect(() =>
    loadConfig({ ...defaults, P13_BASE_URL: "http://p13.localhost:4001" }),
  ).toThrow("match");
  expect(() =>
    loadConfig({ ...defaults, P13_ISSUER: "https://remote.example" }),
  ).toThrow("local tutorial");
  expect(() =>
    loadConfig({
      ...defaults,
      P13_API_RESOURCE: "http://p13.localhost:3013/other",
    }),
  ).toThrow("match");
});
test("setup preserves configuration and learner state on repeat", () => {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/setup-test-"));
  roots.push(root);
  const identity = resolve(root, "identity.env");
  writeFileSync(
    identity,
    [
      "IDP_ISSUER=http://idp.localhost:4000",
      "P13_CLIENT_ID=p13-client",
      "P13_CLIENT_SECRET=temporary-test-secret-at-least-32-characters",
      "P13_API_RESOURCE=http://p13.localhost:3013/api",
      "P13_REDIRECT_URI=http://p13.localhost:3013/auth/callback",
      "P13_POST_LOGOUT_REDIRECT_URI=http://p13.localhost:3013",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  setupProject(root, identity);
  const first = readFileSync(resolve(root, ".env"), "utf8");
  const databasePath = resolve(root, ".local/p13-data/school.sqlite");
  const before = new SchoolDatabase(databasePath, "http://idp.localhost:4000");
  before.sql.exec(
    "UPDATE grades SET feedback='Learner change',version=2 WHERE id='grade-sam-1'",
  );
  before.changeFixture("withdraw-enrollment");
  before.close();
  setupProject(root, identity);
  expect(readFileSync(resolve(root, ".env"), "utf8")).toBe(first);
  const after = new SchoolDatabase(databasePath, "http://idp.localhost:4000");
  expect(after.snapshot("talia", "grade-sam-1")).toMatchObject({
    grade: { feedback: "Learner change", version: 2 },
    enrollment: { state: "withdrawn", version: 2 },
  });
  after.close();
  writeFileSync(
    resolve(root, ".env"),
    first.replace(
      'P13_CLIENT_SECRET="temporary-test-secret-at-least-32-characters"',
      'P13_CLIENT_SECRET="conflicting-test-secret-at-least-32-characters"',
    ),
  );
  setupProject(root, identity);
  expect(readFileSync(resolve(root, ".env"), "utf8")).toContain(
    'P13_CLIENT_SECRET="temporary-test-secret-at-least-32-characters"',
  );
});

test("setup and persisted data reject dangling symlinks and escaped paths", () => {
  mkdirSync(".local", { recursive: true });
  const root = mkdtempSync(resolve(".local/setup-test-"));
  roots.push(root);
  symlinkSync(resolve(root, "missing"), resolve(root, ".env"));
  expect(() => setupProject(root, resolve(root, "identity.env"))).toThrow(
    "regular file",
  );
  mkdirSync(resolve(root, ".local"));
  symlinkSync(resolve(root, "missing-data"), resolve(root, ".local/data"));
  expect(() => containedDataDir(".local/data", root)).toThrow("symlinks");
  expect(() => containedDataDir("../outside", root)).toThrow("child");
});
