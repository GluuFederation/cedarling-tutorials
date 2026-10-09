import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runTutorial, validateManifest } from "./run.mjs";

const tools = dirname(fileURLToPath(import.meta.url));
const toolPath = "shared/tools/step";
const baselinePackage = {
  name: "example",
  scripts: { build: "old-build", check: "old-check", keep: "keep-me" },
  dependencies: { existing: "1.0.0" },
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

test("registered project steps reference available source files and scripts", async () => {
  const root = resolve(tools, "../../..");
  for (const file of await readdir(join(tools, "projects"))) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const manifest = validateManifest(
      JSON.parse(await readFile(join(tools, "projects", file), "utf8")),
      id,
    );
    const pkg = JSON.parse(
      await readFile(join(root, manifest.directory, "package.json"), "utf8"),
    );
    for (const step of manifest.steps) {
      for (const path of step.files) {
        assert.ok((await stat(join(root, path))).isFile(), path);
      }
      for (const key of step.scripts)
        assert.equal(typeof pkg.scripts[key], "string");
    }
  }
});

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function put(root, path, value) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), value);
}

async function fixture(context, mutate) {
  const root = await mkdtemp(join(tmpdir(), "cedarling-step-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Tutorial helper test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  await put(root, ".gitignore", "**/.local/\n");
  await put(root, ".gitattributes", "* text=auto eol=lf\n");
  for (const directory of ["example-one", "another-project"]) {
    await put(root, `${directory}/src/app.js`, "baseline\n");
    await put(root, `${directory}/src/obsolete.js`, "remove-me\n");
    await put(root, `${directory}/package.json`, json(baselinePackage));
  }
  await put(root, "shared/helper.mjs", "baseline-shared\n");
  git(root, "add", ".");
  git(root, "-c", "commit.gpgsign=false", "commit", "-m", "fixture baseline");
  const baseline = git(root, "rev-parse", "HEAD");
  await cp(tools, join(root, toolPath), { recursive: true });
  const manifests = [];
  for (const [id, directory] of [
    ["p1", "example-one"],
    ["future-project", "another-project"],
  ]) {
    const manifest = {
      version: 1,
      id,
      directory,
      baseline,
      steps: [
        {
          id: "server",
          files: [
            `${directory}/src/new.js`,
            `${directory}/src/app.js`,
            "shared/helper.mjs",
          ],
          remove: [`${directory}/src/obsolete.js`],
          scripts: [],
        },
        { id: "checks", files: [], remove: [], scripts: ["build", "test:e2e"] },
      ],
    };
    manifests.push(manifest);
    await put(root, `${directory}/src/app.js`, "integrated\n");
    await put(root, `${directory}/src/new.js`, "new\n");
    await rm(join(root, directory, "src/obsolete.js"));
    await put(
      root,
      `${directory}/package.json`,
      json({
        ...baselinePackage,
        scripts: {
          ...baselinePackage.scripts,
          build: "new-build",
          "test:e2e": "new-test",
        },
      }),
    );
    await put(root, `${toolPath}/projects/${id}.json`, json(manifest));
  }
  await put(root, "shared/helper.mjs", "integrated-shared\n");
  if (mutate) await mutate(root, manifests);
  git(root, "add", ".");
  git(
    root,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture integration",
  );
  const source = git(root, "rev-parse", "HEAD");
  git(root, "switch", "--detach", baseline);
  git(root, "restore", `--source=${source}`, "--worktree", "--", toolPath);
  const output = [];
  const call = (args, options = {}) =>
    runTutorial(args, {
      cwd: root,
      output: (line) => output.push(line),
      confirm: async () => true,
      ...options,
    });
  const read = (path) => readFile(join(root, path), "utf8");
  const state = async () => JSON.parse(await read(".local/step/p1/state.json"));
  const init = () => call(["p1", "init", "--source", source]);
  return { root, baseline, source, manifests, call, read, state, init, output };
}

function confirmCli(f, answer) {
  // Exercise readline's terminal handling over pipes, including its Ctrl+C event.
  const terminal = "process.stdin.isTTY = true; process.stdout.isTTY = true;";
  const child = spawn(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(terminal)}`,
      join(f.root, toolPath, "run.mjs"),
      "p1",
      "server",
    ],
    { cwd: join(f.root, "example-one"), stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let answered = false;
  child.stdout.on("data", (bytes) => {
    stdout += bytes;
    if (!answered && stdout.includes("[y/N]")) {
      answered = true;
      child.stdin.write(answer);
    }
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  return new Promise((done, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CLI confirmation did not finish"));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      done({ code, signal, stdout, stderr, answered });
    });
  });
}

test("initializes a source pin without changing project files, Git HEAD, or the index", async (t) => {
  const f = await fixture(t);
  const index = git(f.root, "diff", "--cached");
  await f.init();
  assert.equal(await f.read("example-one/src/app.js"), "baseline\n");
  assert.deepEqual((await f.state()).completed, []);
  assert.equal((await f.state()).source, f.source);
  assert.equal(git(f.root, "rev-parse", "HEAD"), f.baseline);
  assert.equal(git(f.root, "diff", "--cached"), index);
  assert.equal(
    git(f.root, "check-ignore", ".local/step/p1/state.json"),
    ".local/step/p1/state.json",
  );
  await f.init();
  assert.match(f.output.at(-1), /already initialized/);
});

test("creates, replaces, and removes exactly the named files and preserves package settings", async (t) => {
  const f = await fixture(t);
  await f.init();
  await f.call(["p1", "server", "--yes"]);
  assert.equal(await f.read("example-one/src/app.js"), "integrated\n");
  assert.equal(await f.read("example-one/src/new.js"), "new\n");
  await assert.rejects(f.read("example-one/src/obsolete.js"), {
    code: "ENOENT",
  });
  assert.equal(await f.read("another-project/src/app.js"), "baseline\n");
  const custom = JSON.parse(await f.read("example-one/package.json"));
  custom.dependencies.added = "2.0.0";
  custom.scripts.custom = "my-command";
  await put(f.root, "example-one/package.json", json(custom));
  await f.call(["p1", "checks", "--yes"]);
  const changed = JSON.parse(await f.read("example-one/package.json"));
  assert.deepEqual(changed, {
    ...custom,
    scripts: { ...custom.scripts, build: "new-build", "test:e2e": "new-test" },
  });
  assert.deepEqual((await f.state()).completed, ["server", "checks"]);
});

test("dry run leaves project files, progress, and recovery directories unchanged", async (t) => {
  const f = await fixture(t);
  await f.init();
  const before = await f.read(".local/step/p1/state.json");
  await f.call(["p1", "server", "--dry-run"]);
  assert.equal(await f.read("example-one/src/app.js"), "baseline\n");
  assert.equal(await f.read(".local/step/p1/state.json"), before);
  assert.deepEqual(await readdir(join(f.root, ".local/step/p1")), [
    "state.json",
  ]);
  assert.match(f.output.at(-1), /Dry run/);
});

test("cancellation and missing prerequisites leave the application untouched", async (t) => {
  const f = await fixture(t);
  await f.init();
  await assert.rejects(f.call(["p1", "checks", "--yes"]), /Complete server/);
  await f.call(["p1", "server"], { confirm: async () => false });
  assert.equal(
    f.output.at(-1),
    "Cancelled; no project files or progress changed.",
  );
  assert.equal(await f.read("example-one/src/app.js"), "baseline\n");
  assert.deepEqual((await f.state()).completed, []);
});

test("repeating a completed step does not rewrite files or progress", async (t) => {
  const f = await fixture(t);
  await f.init();
  await f.call(["p1", "server", "--yes"]);
  const before = await stat(join(f.root, "example-one/src/app.js"));
  const state = await f.read(".local/step/p1/state.json");
  await f.call(["p1", "server", "--yes"]);
  assert.equal(
    (await stat(join(f.root, "example-one/src/app.js"))).mtimeMs,
    before.mtimeMs,
  );
  assert.equal(await f.read(".local/step/p1/state.json"), state);
  assert.match(f.output.at(-1), /Already complete/);
  await f.call(["p1", "checks", "--yes"]);
  const complete = await f.read(".local/step/p1/state.json");
  await f.call(["p1", "server", "--yes"]);
  await f.call(["p1", "checks", "--yes"]);
  assert.equal(await f.read(".local/step/p1/state.json"), complete);
  assert.match(f.output.at(-1), /Already complete/);
});

test("edited targets are refused before creating any other target", async (t) => {
  const f = await fixture(t);
  await f.init();
  await put(f.root, "example-one/src/app.js", "learner work\n");
  await assert.rejects(
    f.call(["p1", "server", "--yes"]),
    /Local edits in example-one\/src\/app.js; no files changed.*Before applying server.*save a separate copy.*reconcile/,
  );
  assert.equal(await f.read("example-one/src/app.js"), "learner work\n");
  await assert.rejects(f.read("example-one/src/new.js"), { code: "ENOENT" });
});

test("edited completed steps stay protected while later steps preserve the edits", async (t) => {
  const f = await fixture(t);
  await f.init();
  await f.call(["p1", "server", "--yes"]);
  const before = await f.read(".local/step/p1/state.json");
  await put(f.root, "example-one/src/app.js", "learner experiment\n");
  for (const flag of ["--dry-run", "--yes"]) {
    await assert.rejects(
      f.call(["p1", "server", flag]),
      /server is already complete\. Your edits were preserved\. If they are intentional, continue with checks\./,
    );
  }
  const result = spawnSync(
    process.execPath,
    [join(f.root, toolPath, "run.mjs"), "p1", "server", "--yes"],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(await f.read(".local/step/p1/state.json"), before);
  assert.equal(await f.read("example-one/src/app.js"), "learner experiment\n");
  await f.call(["p1", "checks", "--yes"]);
  assert.equal(await f.read("example-one/src/app.js"), "learner experiment\n");
  assert.deepEqual((await f.state()).completed, ["server", "checks"]);

  const packageJson = JSON.parse(await f.read("example-one/package.json"));
  packageJson.scripts.build = "learner-build";
  await put(f.root, "example-one/package.json", json(packageJson));
  await assert.rejects(
    f.call(["p1", "checks", "--yes"]),
    /scripts.build; no files changed.*checks is already complete.*All steps are complete/,
  );
  assert.equal(await f.read("example-one/package.json"), json(packageJson));
});

test("rechecks targets after confirmation", async (t) => {
  const f = await fixture(t);
  await f.init();
  await assert.rejects(
    f.call(["p1", "server"], {
      confirm: async () => {
        await put(
          f.root,
          "example-one/src/app.js",
          "edited while confirming\n",
        );
        return true;
      },
    }),
    /changed during confirmation/,
  );
  await assert.rejects(f.read("example-one/src/new.js"), { code: "ENOENT" });
});

test("an altered package-script entry is refused without replacing dependencies", async (t) => {
  const f = await fixture(t);
  await f.init();
  await f.call(["p1", "server", "--yes"]);
  const custom = structuredClone(baselinePackage);
  custom.scripts.build = "learner-build";
  await put(f.root, "example-one/package.json", json(custom));
  await assert.rejects(
    f.call(["p1", "checks", "--yes"]),
    /scripts.build; no files changed.*Before applying checks/,
  );
  assert.equal(await f.read("example-one/package.json"), json(custom));
});

test("recovery and lock paths resolve from the caller's directory", async (t) => {
  for (const directory of ["", "example-one"]) {
    const f = await fixture(t);
    const cwd = join(f.root, directory);
    await f.init();
    const lock = ".local/step/lock";
    await put(f.root, lock, "stale test lock");
    await assert.rejects(
      f.call(["p1", "server", "--yes"], { cwd }),
      (error) => {
        assert.ok(
          error.message.includes(`left ${relative(cwd, join(f.root, lock))},`),
        );
        return true;
      },
    );
    await rm(join(f.root, lock));
    let writes = 0;
    let failurePath;
    await assert.rejects(
      f.call(["p1", "server", "--yes"], {
        cwd,
        writeTarget: async (root, path, bytes) => {
          if (++writes === 2) throw new Error("simulated disk failure");
          await put(root, path, bytes);
        },
      }),
      (error) => {
        failurePath = error.message.match(
          /Recovery copies: (.+)\. Progress/,
        )[1];
        return true;
      },
    );
    assert.equal(
      (await stat(join(resolve(cwd, failurePath), "changes.json"))).isFile(),
      true,
    );
    await f.call(["p1", "server", "--yes"], { cwd });
    const successPath = f.output
      .at(-1)
      .match(/Recovery copies: (.+)\. Continue/)[1];
    assert.equal(
      (await stat(join(resolve(cwd, successPath), "changes.json"))).isFile(),
      true,
    );
    const prefix = directory ? `..${sep}.local${sep}` : `.local${sep}`;
    assert.ok(failurePath.startsWith(prefix));
    assert.ok(successPath.startsWith(prefix));
  }
});

test("CLI cancellation has clear output and releases the lock for retry", async (t) => {
  for (const [answer, status] of [
    ["n\n", 0],
    ["\u0003", 130],
  ]) {
    const f = await fixture(t);
    await f.init();
    const before = await f.read(".local/step/p1/state.json");
    const result = await confirmCli(f, answer);
    assert.equal(result.answered, true);
    assert.equal(result.code, status, result.stderr);
    assert.equal(result.signal, null);
    assert.match(
      result.stdout,
      /Cancelled; no project files or progress changed\./,
    );
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /Tutorial step failed/);
    assert.equal(await f.read("example-one/src/app.js"), "baseline\n");
    assert.equal(await f.read(".local/step/p1/state.json"), before);
    await assert.rejects(f.read(".local/step/lock"), {
      code: "ENOENT",
    });
    assert.deepEqual(await readdir(join(f.root, ".local/step/p1")), [
      "state.json",
    ]);
    await f.call(["p1", "server", "--yes"]);
    assert.deepEqual((await f.state()).completed, ["server"]);
  }
});

test("write failure retains recovery copies and rerunning finishes the step", async (t) => {
  const f = await fixture(t);
  await f.init();
  let writes = 0;
  await assert.rejects(
    f.call(["p1", "server", "--yes"], {
      writeTarget: async (root, path, bytes) => {
        if (++writes === 2) throw new Error("simulated disk failure");
        await put(root, path, bytes);
      },
    }),
    /Some files may already be updated\. Recovery copies:.*Progress was not advanced/,
  );
  assert.deepEqual((await f.state()).completed, []);
  const attempts = await readdir(join(f.root, ".local/step/p1/recovery"));
  const recovery = `.local/step/p1/recovery/${attempts[0]}`;
  const journal = JSON.parse(await f.read(`${recovery}/changes.json`));
  const app = journal.files.find((item) => item.path.endsWith("/app.js"));
  assert.equal(await f.read(`${recovery}/${app.backup}`), "baseline\n");
  await f.call(["p1", "server", "--yes"]);
  assert.equal(await f.read("example-one/src/app.js"), "integrated\n");
  assert.deepEqual((await f.state()).completed, ["server"]);
});

test("requires a declared baseline and all source files before initialization", async (t) => {
  const f = await fixture(t);
  await put(f.root, "example-one/src/app.js", "different baseline\n");
  await assert.rejects(f.init(), /Local edits/);
  await assert.rejects(f.state(), { code: "ENOENT" });
  const missing = await fixture(t, async (root, manifests) => {
    manifests[0].steps[0].files.push("example-one/src/missing.js");
    await put(root, `${toolPath}/projects/p1.json`, json(manifests[0]));
  });
  await assert.rejects(missing.init(), /Missing or inconsistent source/);
  assert.equal(await missing.read("example-one/src/app.js"), "baseline\n");
});

test("requires full available commit SHAs and a matching helper installation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.call(["p1", "init", "--source", "main"]),
    /40-character/,
  );
  await assert.rejects(
    f.call(["p1", "init", "--source", "f".repeat(40)]),
    /git fetch origin/,
  );
  await put(f.root, `${toolPath}/run.mjs`, "modified helper\n");
  await assert.rejects(f.init(), /Helper differs/);
});

test("another project uses its own manifest and state in a separate checkout", async (t) => {
  const first = await fixture(t);
  await first.init();
  await assert.rejects(
    first.call(["future-project", "init", "--source", first.source]),
    /separate checkout/,
  );
  const second = await fixture(t);
  await second.call(["future-project", "init", "--source", second.source]);
  await second.call(["future-project", "server", "--yes"], {
    cwd: join(second.root, "another-project"),
  });
  assert.equal(await second.read("another-project/src/app.js"), "integrated\n");
  assert.equal(await second.read("example-one/src/app.js"), "baseline\n");
  assert.equal(
    JSON.parse(await second.read(".local/step/future-project/state.json"))
      .project,
    "future-project",
  );
  assert.deepEqual((await first.state()).completed, []);
});

test("runs from the project directory but refuses another project directory", async (t) => {
  const f = await fixture(t);
  await f.call(["p1", "init", "--source", f.source], {
    cwd: join(f.root, "example-one"),
  });
  await assert.rejects(
    f.call(["p1", "server", "--yes"], { cwd: join(f.root, "another-project") }),
    /Run this command/,
  );
});

test("rejects unsafe or cross-project manifests and executable options", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "../outside",
    "/tmp/outside",
    "example-one/../outside",
    "example-one/.env",
    "example-one/.data/db",
    "example-one/src/NUL.txt",
    "example-one/src/file:ads",
    "example-one/src/*.js",
    "example-one/src/file?.js",
    "another-project/src/app.js",
    `${toolPath}/run.mjs`,
    "example-one/package.json",
  ]) {
    const value = structuredClone(f.manifests[0]);
    value.steps[0].files[0] = path;
    assert.throws(() => validateManifest(value, "p1"));
  }
  const value = structuredClone(f.manifests[0]);
  value.steps[0].command = "do-not-execute";
  assert.throws(() => validateManifest(value, "p1"), /Unknown step option/);
});

test("copies a bracketed route literally without changing a sibling", async (t) => {
  const route = "example-one/app/articles/[articleId]/page.tsx";
  const sibling = "example-one/app/articles/a/page.tsx";
  const f = await fixture(t, async (root, manifests) => {
    manifests[0].steps[0].files.push(route);
    await put(root, route, "reviewed route\n");
    await put(root, sibling, "source sibling\n");
    await put(root, `${toolPath}/projects/p1.json`, json(manifests[0]));
  });
  await put(f.root, sibling, "learner sibling\n");
  await f.init();
  await f.call(["p1", "server", "--yes"]);
  assert.equal(await f.read(route), "reviewed route\n");
  assert.equal(await f.read(sibling), "learner sibling\n");
  await f.call(["p1", "server", "--yes"]);
  assert.equal(await f.read(route), "reviewed route\n");
  assert.equal(git(f.root, "rev-parse", "HEAD"), f.baseline);
  assert.equal(git(f.root, "diff", "--cached"), "");
});

test("rejects symlinked destination parents, including Windows junctions", async (t) => {
  const f = await fixture(t);
  await f.init();
  await rename(
    join(f.root, "example-one/src"),
    join(f.root, "example-one/saved-src"),
  );
  await symlink(
    join(f.root, "example-one/saved-src"),
    join(f.root, "example-one/src"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(f.call(["p1", "server", "--yes"]), /Symlink refused/);
  assert.equal(await f.read("example-one/saved-src/app.js"), "baseline\n");
});

test("refuses corrupt progress and concurrent use", async (t) => {
  const f = await fixture(t);
  await f.init();
  await put(f.root, ".local/step/lock", "test-lock");
  await assert.rejects(
    f.call(["p1", "server", "--yes"]),
    /Another tutorial step/,
  );
  await rm(join(f.root, ".local/step/lock"));
  const state = await f.state();
  state.completed = ["checks"];
  await put(f.root, ".local/step/p1/state.json", json(state));
  await assert.rejects(
    f.call(["p1", "server", "--yes"]),
    /Invalid step progress/,
  );
});

test("rejects an extra local manifest absent from the pinned source", async (t) => {
  const f = await fixture(t);
  const extra = { ...f.manifests[0], id: "local-project" };
  await put(f.root, `${toolPath}/projects/local-project.json`, json(extra));
  await assert.rejects(
    f.call(["local-project", "init", "--source", f.source]),
    /not registered in the pinned source/,
  );
});

test("refuses changing the source pin after initialization", async (t) => {
  const f = await fixture(t);
  await f.init();
  const otherSource = git(
    f.root,
    "-c",
    "commit.gpgsign=false",
    "commit-tree",
    `${f.source}^{tree}`,
    "-p",
    f.source,
    "-m",
    "another source",
  );
  await assert.rejects(
    f.call(["p1", "init", "--source", otherSource]),
    /pinned to another source/,
  );
});

test("refuses a symlinked state directory", async (t) => {
  const f = await fixture(t);
  await f.init();
  await rename(join(f.root, ".local/step"), join(f.root, ".local/saved-state"));
  await symlink(
    join(f.root, ".local/saved-state"),
    join(f.root, ".local/step"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(f.call(["p1", "server", "--yes"]), /Symlink refused/);
});

test("requires ignored, untracked state before initialization", async (t) => {
  const f = await fixture(t);
  await put(f.root, ".gitignore", "");
  await assert.rejects(f.init(), /ignored and untracked/);
  await put(f.root, ".gitignore", "**/.local/\n");
  await put(f.root, ".local/step/tracked.json", "{}\n");
  git(f.root, "add", "--force", ".local/step/tracked.json");
  await assert.rejects(f.init(), /ignored and untracked/);
});

test("CLI requires explicit confirmation in non-interactive use and handles unknown arguments", async (t) => {
  const f = await fixture(t);
  await f.init();
  const cli = join(f.root, toolPath, "run.mjs");
  const result = spawnSync(process.execPath, [cli, "p1", "server"], {
    cwd: f.root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Interactive confirmation/);
  assert.equal(await f.read("example-one/src/app.js"), "baseline\n");
  await assert.rejects(f.call(["p1", "server", "--force"]), /Unknown option/);
  await assert.rejects(f.call(["p1", "unknown", "--yes"]), /Unknown step/);
  await assert.rejects(
    f.call(["p1", "server", "--yes", "--dry-run"]),
    /Choose/,
  );
});
