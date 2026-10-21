import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps the served page available while the development watcher rebuilds", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "p8-watch-"));
  const project = resolve(import.meta.dirname, "..");
  const script = readFileSync(resolve(project, "scripts/dev.mjs"), "utf8");
  const command = script.match(
    /args:\s*(\[\s*"exec",\s*"vite",\s*"build",\s*"--watch"[^\]]*\])/u,
  )?.[1];
  if (!command) throw new Error("Development watcher command is missing");
  const args = [...command.matchAll(/"([^"]+)"/gu)]
    .map((match) => match[1] as string)
    .slice(2);
  mkdirSync(resolve(root, "dist"));
  writeFileSync(
    resolve(root, "index.html"),
    "<html><body>new page</body></html>",
  );
  writeFileSync(resolve(root, "dist/index.html"), "previous page");
  writeFileSync(
    resolve(root, "vite.config.mjs"),
    `
    import { writeFileSync } from 'node:fs';
    export default {
      build: { outDir: 'dist', emptyOutDir: true },
      plugins: [{ name: 'slow-fixture-build', async renderStart() {
        writeFileSync('building', 'started');
        await new Promise(resolve => setTimeout(resolve, 500));
      } }],
    };
  `,
  );
  const watcher = spawn(
    process.execPath,
    [resolve(project, "node_modules/vite/bin/vite.js"), ...args],
    {
      cwd: root,
      stdio: "ignore",
    },
  );
  const exited = once(watcher, "exit");
  try {
    await expect
      .poll(() => existsSync(resolve(root, "building")), { timeout: 10_000 })
      .toBe(true);
    expect(existsSync(resolve(root, "dist/index.html"))).toBe(true);
    await expect
      .poll(
        () => {
          try {
            return readFileSync(resolve(root, "dist/index.html"), "utf8");
          } catch {
            return "";
          }
        },
        { timeout: 10_000 },
      )
      .toContain("new page");
  } finally {
    watcher.kill("SIGTERM");
    const timeout = setTimeout(() => watcher.kill("SIGKILL"), 3000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
