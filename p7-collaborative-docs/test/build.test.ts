import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("rebuilds a missing server entry even when compiler metadata is cached", () => {
  const root = mkdtempSync(resolve(tmpdir(), "server-build-"));
  const project = resolve(import.meta.dirname, "..");
  const configFile = resolve(root, "tsconfig.json");
  const sourceConfig = JSON.parse(
    readFileSync(resolve(project, "tsconfig.server.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(resolve(project, "package.json"), "utf8"),
  );
  const compilerArgs = manifest.scripts.build
    .split(" && ")
    .at(-1)
    .split(" ")
    .slice(1)
    .map((arg: string) => (arg === "tsconfig.server.json" ? configFile : arg));
  const output = resolve(root, "dist/server/main.js");
  try {
    writeFileSync(
      configFile,
      JSON.stringify({
        ...sourceConfig,
        compilerOptions: {
          ...sourceConfig.compilerOptions,
          rootDir: resolve(project, "src"),
          outDir: resolve(root, "dist"),
          tsBuildInfoFile: resolve(root, "server.tsbuildinfo"),
          typeRoots: [resolve(project, "node_modules/@types")],
        },
        include: sourceConfig.include.map((glob: string) =>
          resolve(project, glob),
        ),
      }),
    );
    const build = () => {
      const result = spawnSync(
        process.execPath,
        [resolve(project, "node_modules/typescript/bin/tsc"), ...compilerArgs],
        { cwd: project, encoding: "utf8", timeout: 20_000 },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
    };
    build();
    expect(existsSync(output)).toBe(true);
    rmSync(output);
    build();
    expect(existsSync(output)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
