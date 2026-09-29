import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeProjectEnvironment,
  readProjectEnvironment,
  writePrivateEnvironment,
} from "../scripts/project-environment.mjs";

const temporaryDirectories: string[] = [];
const setupScript = resolve(import.meta.dirname, "../scripts/setup.mjs");

function temporaryDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), "cedarling-idp-setup-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("identity-provider setup", () => {
  it.each(Array.from({ length: 15 }, (_, index) => `P${index + 1}`))(
    "creates only %s registration and preserves credentials on repeat",
    (project) => {
      const directory = temporaryDirectory();
      const target = resolve(directory, ".env");
      const run = () =>
        execFileSync(process.execPath, [setupScript, project, target], {
          cwd: directory,
        });
      run();
      const content = readFileSync(target, "utf8");
      const env = parseEnv(content);
      expect(env.IDP_PROJECT).toBe(project);
      expect(env.IDP_ISSUER).toBe(
        `http://localhost:${18000 + Number(project.slice(1))}`,
      );
      expect(
        Object.keys(env)
          .filter((key) => /^P\d+_/.test(key))
          .every((key) => key.startsWith(project + "_")),
      ).toBe(true);
      if (process.platform !== "win32")
        expect(statSync(target).mode & 0o777).toBe(0o600);
      run();
      expect(readFileSync(target, "utf8")).toBe(content);
    },
  );

  it("synchronizes only IdP-owned project settings", () => {
    const merged = mergeProjectEnvironment(
      "# local settings\r\nP12_CLIENT_SECRET=stale\r\nP12_DATA_DIR=custom-data\r\n",
      {
        managed: { P12_CLIENT_SECRET: "current" },
        defaults: {
          P12_DATA_DIR: ".local/p12-data",
          P12_SESSION_SECRET: "local-session",
        },
      },
    );
    expect(merged.text).toBe(
      '# local settings\r\nP12_CLIENT_SECRET="current"\r\nP12_DATA_DIR=custom-data\r\nP12_SESSION_SECRET="local-session"\r\n',
    );
    expect(merged.environment).toMatchObject({
      P12_CLIENT_SECRET: "current",
      P12_DATA_DIR: "custom-data",
      P12_SESSION_SECRET: "local-session",
    });
    expect(merged.synchronizedKeys).toEqual([
      "P12_CLIENT_SECRET",
      "P12_SESSION_SECRET",
    ]);
  });

  it("rejects duplicate keys and unsafe project environment files", () => {
    expect(() =>
      mergeProjectEnvironment("VALUE=one\nVALUE=two\n", {
        managed: { VALUE: "current" },
      }),
    ).toThrow("Duplicate environment key: VALUE");

    const directory = temporaryDirectory();
    const target = resolve(directory, ".env");
    writePrivateEnvironment(target, 'VALUE="current"\n');
    expect(readProjectEnvironment(target).environment.VALUE).toBe("current");
    expect(writePrivateEnvironment(target, 'VALUE="current"\n')).toBe(false);
  });
});
