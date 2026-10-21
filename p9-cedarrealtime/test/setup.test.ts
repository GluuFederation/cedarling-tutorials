import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { expect, it } from "vitest";
import { ensureProjectIdentity } from "../../shared/identity-provider/scripts/setup.mjs";

it.each([17009, 4209])(
  "repairs a stale port using registration %s without replacing local settings",
  (port) => {
    const root = mkdtempSync(resolve(tmpdir(), "p9-setup-"));
    try {
      const identityFile = resolve(root, ".local/idp/.env");
      ensureProjectIdentity("P9", identityFile);
      const registration = readFileSync(identityFile, "utf8").replaceAll(
        "localhost:17009",
        `localhost:${port}`,
      );
      writeFileSync(identityFile, registration);
      const target = resolve(root, ".env");
      writeFileSync(
        target,
        [
          "# Keep learner settings",
          "P9_PORT=3009",
          "P9_BASE_URL=http://p9.localhost:3009",
          "P9_LOCAL_NOTE=keep",
          "",
        ].join("\n"),
      );
      const run = () =>
        spawnSync(
          process.execPath,
          [resolve(import.meta.dirname, "../scripts/setup.ts")],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 20_000,
          },
        );
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      const content = readFileSync(target, "utf8");
      expect(parseEnv(content)).toMatchObject({
        P9_PORT: String(port),
        P9_BASE_URL: `http://localhost:${port}`,
        P9_CLIENT_SECRET: parseEnv(registration).P9_CLIENT_SECRET,
        P9_LOCAL_NOTE: "keep",
      });
      expect(content).toContain("# Keep learner settings");
      const second = run();
      expect(second.status, second.stderr).toBe(0);
      expect(readFileSync(target, "utf8")).toBe(content);
      expect(readFileSync(identityFile, "utf8")).toBe(registration);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
