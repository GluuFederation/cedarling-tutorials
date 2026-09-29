import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { test } from "vitest";

const projects = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "P13",
  "P14",
  "P15",
];

for (const project of projects) {
  test(`${project} Docker credentials match and survive repeated initialization`, () => {
    const root = mkdtempSync(resolve(tmpdir(), "tutorial-bootstrap-"));
    const identity = resolve(root, "identity");
    const app = resolve(root, "app");
    const p10Directories = Object.fromEntries(
      ["console", "api", "planner", "north", "south", "auditor"].map((name) => [
        name,
        resolve(root, `p10-${name}`),
      ]),
    );
    for (const directory of [identity, app, ...Object.values(p10Directories)]) {
      mkdirSync(directory);
    }
    const run = () =>
      spawnSync(
        process.execPath,
        [resolve("scripts/docker-bootstrap.mjs"), project],
        {
          env: {
            ...process.env,
            BOOTSTRAP_IDENTITY_DIR: identity,
            BOOTSTRAP_APP_DIR: app,
            ...Object.fromEntries(
              Object.entries(p10Directories).map(([name, directory]) => [
                `BOOTSTRAP_P10_${name.toUpperCase()}_DIR`,
                directory,
              ]),
            ),
          },
          encoding: "utf8",
        },
      );
    try {
      const first = run();
      assert.equal(first.status, 0, first.stderr);
      const registration = parseEnv(
        readFileSync(resolve(identity, ".env"), "utf8"),
      );
      if (project === "P10") {
        const files = {
          console: "console.env",
          api: "api.env",
          planner: "agent.env",
          north: "agent.env",
          south: "agent.env",
          auditor: "agent.env",
        };
        const before = Object.fromEntries(
          Object.entries(files).map(([name, file]) => [
            name,
            readFileSync(resolve(p10Directories[name], file), "utf8"),
          ]),
        );
        const api = parseEnv(before.api);
        assert.equal(
          Object.keys(api).some((key) => key.endsWith("_CLIENT_SECRET")),
          false,
        );
        for (const [name, prefix] of [
          ["planner", "P10_TRANSFER_PLANNER"],
          ["north", "P10_WAREHOUSE_NORTH"],
          ["south", "P10_WAREHOUSE_SOUTH"],
          ["auditor", "P10_INVENTORY_AUDITOR"],
        ]) {
          const agent = parseEnv(before[name]);
          assert.equal(
            agent[`${prefix}_CLIENT_SECRET`],
            registration[`${prefix}_CLIENT_SECRET`],
          );
          assert.equal(
            api[`${prefix}_CLIENT_ID`],
            registration[`${prefix}_CLIENT_ID`],
          );
          assert.equal(
            Object.keys(agent).filter((key) => key.endsWith("_CLIENT_SECRET"))
              .length,
            1,
          );
        }
        const apiFile = resolve(p10Directories.api, files.api);
        writeFileSync(
          apiFile,
          before.api.replace(/^P10_TRANSFER_PLANNER_CLIENT_ID=.*\n/mu, ""),
        );
        assert.equal(run().status, 0);
        for (const [name, file] of Object.entries(files)) {
          assert.equal(
            readFileSync(resolve(p10Directories[name], file), "utf8"),
            before[name],
          );
        }
        rmSync(resolve(p10Directories.console, "console.env"));
        symlinkSync(
          resolve(root, "missing"),
          resolve(p10Directories.console, "console.env"),
        );
      } else {
        const appFile = resolve(app, "app.env");
        const before = readFileSync(appFile, "utf8");
        const config = parseEnv(before);
        for (const [name, value] of Object.entries(config)) {
          if (name.endsWith("_CLIENT_SECRET"))
            assert.equal(value, registration[name]);
        }
        if (["P6", "P7"].includes(project)) {
          const number = Number(project.slice(1));
          assert.equal(
            config[`${project}_BASE_URL`],
            `http://localhost:${17000 + number}`,
          );
          assert.equal(
            config[`${project}_ISSUER`],
            `http://localhost:${18000 + number}`,
          );
        }
        assert.equal(run().status, 0);
        assert.equal(readFileSync(appFile, "utf8"), before);
        rmSync(appFile);
        symlinkSync(resolve(root, "missing"), appFile);
      }
      assert.notEqual(run().status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
