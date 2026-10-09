// Applies reviewed tutorial file groups without changing Git history or runtime data.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const toolPath = "shared/tools/step";
const statePath = ".local/step";
const commitPattern = /^[0-9a-f]{40}$/;
const idPattern = /^[a-z][a-z0-9-]*$/;
const maxFileBytes = 2 * 1024 * 1024;
const cancellationMessage = "Cancelled; no project files or progress changed.";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const equal = (a, b) => (a === null || b === null ? a === b : a.equals(b));

class LocalEditsError extends Error {
  constructor(target) {
    super(`Local edits in ${target}; no files changed.`);
    this.name = "LocalEditsError";
  }
}

class ConfirmationInterrupted extends Error {
  constructor() {
    super(cancellationMessage);
    this.name = "ConfirmationInterrupted";
  }
}

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function git(root, args) {
  // check-ignore takes file names, not pathspecs, and rejects pathspec magic.
  const literal = ["ls-tree", "ls-files"].includes(args[0])
    ? ["--literal-pathspecs"]
    : [];
  return execFileSync("git", [...literal, "-C", root, ...args], {
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJSON(bytes, label) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    requireThat(object(value), "Expected an object");
    return value;
  } catch {
    throw new Error(`Invalid JSON object: ${label}`);
  }
}

function validatePath(path) {
  requireThat(
    typeof path === "string" && path.length < 240,
    "Invalid file path",
  );
  for (const part of path.split("/")) {
    requireThat(
      /^[A-Za-z0-9_.\[\]-]+$/.test(part) &&
        part !== "." &&
        part !== ".." &&
        !part.endsWith(".") &&
        !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      `Unsafe path: ${path}`,
    );
    requireThat(
      ![".git", ".local", ".data", "node_modules", "dist", "build"].includes(
        part.toLowerCase(),
      ) && !(part.toLowerCase().startsWith(".env") && part !== ".env.example"),
      `Protected path: ${path}`,
    );
  }
  return path;
}

export function validateManifest(value, project) {
  requireThat(
    object(value) && value.version === 1 && value.id === project,
    "Invalid project manifest",
  );
  requireThat(
    commitPattern.test(value.baseline),
    "Manifest requires a full baseline commit SHA",
  );
  validatePath(value.directory);
  requireThat(
    !value.directory.includes("/") &&
      !value.directory.startsWith(".") &&
      value.directory !== "shared",
    "Invalid project directory",
  );
  requireThat(
    Array.isArray(value.steps) &&
      value.steps.length > 0 &&
      value.steps.length <= 32,
    "Invalid step list",
  );
  const stepIds = new Set();
  const paths = new Set();
  const scripts = new Set();
  for (const step of value.steps) {
    requireThat(
      object(step) &&
        idPattern.test(step.id) &&
        step.id !== "init" &&
        !stepIds.has(step.id),
      "Invalid or duplicate step ID",
    );
    stepIds.add(step.id);
    requireThat(
      Object.keys(step).every((key) =>
        ["id", "files", "remove", "scripts"].includes(key),
      ),
      "Unknown step option",
    );
    for (const operation of ["files", "remove", "scripts"]) {
      requireThat(
        Array.isArray(step[operation]) && step[operation].length <= 128,
        `Invalid ${operation} list`,
      );
    }
    requireThat(
      step.files.length + step.remove.length + step.scripts.length > 0,
      "Empty step",
    );
    for (const path of [...step.files, ...step.remove]) {
      validatePath(path);
      requireThat(
        path.startsWith(`${value.directory}/`) || path.startsWith("shared/"),
        `Path outside project/shared scope: ${path}`,
      );
      requireThat(
        !path.startsWith("shared/tools/") &&
          !path.endsWith("/package.json") &&
          !path.endsWith("/pnpm-lock.yaml"),
        `Use declared script edits instead: ${path}`,
      );
      requireThat(
        !paths.has(path.toLowerCase()),
        `File appears in multiple operations: ${path}`,
      );
      paths.add(path.toLowerCase());
    }
    for (const key of step.scripts) {
      requireThat(
        typeof key === "string" &&
          /^[a-z][a-z0-9:-]*$/.test(key) &&
          !["constructor", "prototype"].includes(key) &&
          !scripts.has(key),
        "Invalid or repeated script entry",
      );
      scripts.add(key);
    }
  }
  requireThat(
    Object.keys(value).every((key) =>
      ["version", "id", "directory", "baseline", "steps"].includes(key),
    ),
    "Unknown manifest option",
  );
  return value;
}

function requireCommit(root, sha) {
  requireThat(
    commitPattern.test(sha ?? ""),
    "Use the full 40-character reviewed commit SHA, not a branch or placeholder",
  );
  try {
    requireThat(
      git(root, ["cat-file", "-t", sha]).toString().trim() === "commit",
      "Not a commit",
    );
  } catch {
    throw new Error(
      `Commit ${sha} is unavailable. Run git fetch origin, then retry with the reviewed SHA.`,
    );
  }
}

function sourceFile(root, commit, path) {
  const entry = git(root, ["ls-tree", "-z", commit, "--", path]).toString(
    "utf8",
  );
  if (!entry) return null;
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(entry);
  requireThat(
    match && match[3] === path,
    `Source must be a regular file: ${path}`,
  );
  const size = Number(git(root, ["cat-file", "-s", match[2]]).toString());
  requireThat(size <= maxFileBytes, `Source file exceeds 2 MiB: ${path}`);
  return {
    bytes: git(root, ["cat-file", "blob", match[2]]),
    mode: match[1] === "100755" ? 0o755 : 0o644,
  };
}

// Check every existing component, including ignored state directories.
async function safePath(root, path, directory = false) {
  const parts = path.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    requireThat(!info.isSymbolicLink(), `Symlink refused: ${path}`);
    if (i < parts.length - 1 || directory)
      requireThat(info.isDirectory(), `Expected directory: ${path}`);
    else requireThat(info.isFile(), `Expected regular file: ${path}`);
  }
}

async function currentFile(root, path) {
  await safePath(root, path);
  try {
    const info = await lstat(join(root, path));
    requireThat(info.size <= maxFileBytes, `Local file exceeds 2 MiB: ${path}`);
    return await readFile(join(root, path));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function makeDirectory(root, path) {
  await safePath(root, path, true);
  await mkdir(join(root, path), { recursive: true });
  await safePath(root, path, true);
}

async function writeAtomic(root, path, bytes, mode = 0o600) {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) await makeDirectory(root, parent);
  await safePath(root, path);
  const target = join(root, path);
  const temporary = `${target}.tutorial-${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", mode);
  try {
    await file.writeFile(bytes);
    await file.close();
    await rename(temporary, target);
  } finally {
    await file.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function verifyTools(root, source) {
  const entries = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    source,
    "--",
    toolPath,
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  requireThat(
    entries.includes(`${toolPath}/run.mjs`),
    "The source commit does not contain the tutorial helper",
  );
  for (const path of entries) {
    validatePath(path);
    requireThat(
      equal(
        await currentFile(root, path),
        sourceFile(root, source, path)?.bytes ?? null,
      ),
      `Helper differs from its pinned source: ${path}. Use a fresh checkout and the matching helper.`,
    );
  }
}

function packageScripts(bytes, label) {
  const value = parseJSON(bytes, label);
  requireThat(object(value.scripts), `Missing scripts object: ${label}`);
  return value;
}

async function prepare(root, manifest, source, step) {
  const changes = [];
  for (const [paths, removing] of [
    [step.files, false],
    [step.remove, true],
  ]) {
    for (const path of paths) {
      const baseline = sourceFile(root, manifest.baseline, path);
      const target = sourceFile(root, source, path);
      requireThat(
        removing ? baseline && !target : target,
        `Missing or inconsistent source operation: ${path}`,
      );
      const before = await currentFile(root, path);
      const after = removing ? null : target.bytes;
      if (!equal(before, baseline?.bytes ?? null) && !equal(before, after))
        throw new LocalEditsError(path);
      changes.push({
        path,
        before,
        after,
        mode: target?.mode ?? baseline.mode,
      });
    }
  }
  if (step.scripts.length) {
    const path = `${manifest.directory}/package.json`;
    const before = await currentFile(root, path);
    requireThat(before !== null, `Missing ${path}`);
    const current = packageScripts(before, path);
    const baseline = packageScripts(
      sourceFile(root, manifest.baseline, path)?.bytes,
      path,
    );
    const target = packageScripts(sourceFile(root, source, path)?.bytes, path);
    requireThat(
      current.name === baseline.name && target.name === baseline.name,
      `Unexpected package name: ${path}`,
    );
    let edited = false;
    for (const key of step.scripts) {
      requireThat(
        Object.hasOwn(target.scripts, key) &&
          typeof target.scripts[key] === "string",
        `Missing source script: ${key}`,
      );
      const prior = Object.hasOwn(baseline.scripts, key)
        ? baseline.scripts[key]
        : undefined;
      const actual = Object.hasOwn(current.scripts, key)
        ? current.scripts[key]
        : undefined;
      if (actual !== prior && actual !== target.scripts[key])
        throw new LocalEditsError(`${path} scripts.${key}`);
      if (actual !== target.scripts[key]) {
        current.scripts[key] = target.scripts[key];
        edited = true;
      }
    }
    changes.push({
      path,
      before,
      after: edited
        ? Buffer.from(`${JSON.stringify(current, null, 2)}\n`)
        : before,
      mode: 0o644,
      scripts: step.scripts,
    });
  }
  return changes;
}

function parseArguments(args) {
  const [project, step, ...flags] = args;
  requireThat(
    idPattern.test(project ?? "") && idPattern.test(step ?? ""),
    "Usage: node run.mjs <project> init --source <sha> | <project> <step> [--dry-run | --yes]",
  );
  const options = { project, step, yes: false, dryRun: false };
  const seen = new Set();
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    requireThat(!seen.has(flag), `Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === "--source" && step === "init") options.source = flags[++i];
    else if (flag === "--yes" && step !== "init") options.yes = true;
    else if (flag === "--dry-run" && step !== "init") options.dryRun = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  requireThat(!(options.yes && options.dryRun), "Choose --dry-run or --yes");
  return options;
}

function validateState(state, project, manifest) {
  requireThat(
    object(state) &&
      state.version === 1 &&
      state.project === project &&
      commitPattern.test(state.source) &&
      state.baseline === manifest.baseline,
    "Invalid tutorial state; keep its recovery files and use a fresh checkout",
  );
  requireThat(
    Array.isArray(state.completed) &&
      state.completed.every((id, index) => id === manifest.steps[index]?.id),
    "Invalid step progress",
  );
}

async function exclusive(root, cwd, action) {
  await makeDirectory(root, statePath);
  const path = `${statePath}/lock`;
  await safePath(root, path);
  let file;
  try {
    file = await open(join(root, path), "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Another tutorial step may be running. If an interrupted run left ${relative(cwd, join(root, path))}, stop that run before removing only that lock file.`,
      );
    throw error;
  }
  try {
    await file.writeFile(String(process.pid));
    return await action();
  } finally {
    await file.close();
    await unlink(join(root, path));
  }
}

async function confirmTerminal(message) {
  requireThat(
    process.stdin.isTTY && process.stdout.isTTY,
    "Interactive confirmation requires a terminal; use --dry-run to inspect or --yes to apply",
  );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  terminal.once("SIGINT", interrupt);
  process.once("SIGINT", interrupt);
  try {
    return /^y(?:es)?$/i.test(
      (
        await terminal.question(`${message} [y/N] `, {
          signal: controller.signal,
        })
      ).trim(),
    );
  } catch (error) {
    if (controller.signal.aborted) throw new ConfirmationInterrupted();
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    terminal.off("SIGINT", interrupt);
    terminal.close();
  }
}

export async function runTutorial(
  args,
  {
    cwd = process.cwd(),
    output = (line) => process.stdout.write(`${line}\n`),
    confirm = confirmTerminal,
    // Injected only by local tests to exercise filesystem failures; never read from manifests.
    writeTarget = writeAtomic,
  } = {},
) {
  cwd = await realpath(cwd);
  const options = parseArguments(args);
  const root = await realpath(
    git(cwd, ["rev-parse", "--show-toplevel"]).toString().trim(),
  );
  const path = `${toolPath}/projects/${options.project}.json`;
  const bytes = await currentFile(root, path);
  requireThat(bytes, `No tutorial steps are registered for ${options.project}`);
  const manifest = validateManifest(parseJSON(bytes, path), options.project);
  const working = relative(root, cwd).split(sep).join("/");
  requireThat(
    working === "" || working === manifest.directory,
    `Run this command from the repository root or ${manifest.directory}/`,
  );
  const projectState = `${statePath}/${options.project}/state.json`;
  await safePath(root, projectState);
  try {
    git(root, ["check-ignore", "--no-index", "--quiet", "--", projectState]);
    requireThat(
      !git(root, ["ls-files", "--", statePath]).length,
      "Tracked helper state",
    );
  } catch {
    throw new Error(
      "Tutorial state must be ignored and untracked. Use the tutorial's baseline checkout before initializing.",
    );
  }
  const savedBytes = await currentFile(root, projectState);
  const state = savedBytes ? parseJSON(savedBytes, projectState) : null;
  if (state) validateState(state, options.project, manifest);
  const source = options.step === "init" ? options.source : state?.source;
  if (options.step !== "init")
    requireThat(
      state,
      `Initialize ${options.project} first with init --source <reviewed-commit-sha>`,
    );
  requireCommit(root, source);
  requireCommit(root, manifest.baseline);
  await verifyTools(root, source);
  requireThat(
    equal(bytes, sourceFile(root, source, path)?.bytes ?? null),
    "Project manifest is not registered in the pinned source",
  );

  const action = async () => {
    // A second process must not apply a stale plan after the first releases its lock.
    requireThat(
      equal(await currentFile(root, projectState), savedBytes),
      "Tutorial state changed; retry the command",
    );
    await safePath(root, statePath, true);
    let directories = [];
    try {
      directories = await readdir(join(root, statePath), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const entry of directories) {
      requireThat(!entry.isSymbolicLink(), "Symlink in tutorial state");
      if (
        entry.isDirectory() &&
        entry.name !== options.project &&
        (await currentFile(root, `${statePath}/${entry.name}/state.json`))
      ) {
        throw new Error(
          `This checkout belongs to ${entry.name}. Use a separate checkout for ${options.project}.`,
        );
      }
    }
    if (options.step === "init") {
      if (state) {
        requireThat(
          state.source === source,
          "This project is pinned to another source; use a separate checkout for a different tutorial version",
        );
        output(`${options.project} is already initialized at ${source}.`);
        return;
      }
      // Check the declared starting files, including the files the integration will delete.
      for (const step of manifest.steps) {
        for (const change of await prepare(root, manifest, source, step)) {
          if (!change.scripts)
            requireThat(
              equal(
                change.before,
                sourceFile(root, manifest.baseline, change.path)?.bytes ?? null,
              ),
              `Start from the declared baseline; ${change.path} is already changed`,
            );
        }
      }
      await writeAtomic(
        root,
        projectState,
        Buffer.from(
          `${JSON.stringify({ version: 1, project: options.project, baseline: manifest.baseline, source, completed: [] }, null, 2)}\n`,
        ),
      );
      output(
        `Initialized ${options.project} at source ${source}. Baseline: ${manifest.baseline}.`,
      );
      return;
    }
    const index = manifest.steps.findIndex((step) => step.id === options.step);
    requireThat(
      index >= 0,
      `Unknown step. Choose: ${manifest.steps.map((step) => step.id).join(", ")}`,
    );
    if (index > state.completed.length)
      throw new Error(
        `Complete ${manifest.steps[state.completed.length].id} before ${options.step}`,
      );
    let changes;
    try {
      changes = await prepare(root, manifest, source, manifest.steps[index]);
    } catch (error) {
      if (!(error instanceof LocalEditsError)) throw error;
      const next = manifest.steps[state.completed.length]?.id;
      const guidance = state.completed.includes(options.step)
        ? `${options.step} is already complete. Your edits were preserved. ${next ? `If they are intentional, continue with ${next}.` : "All steps are complete; continue with the tutorial's verification commands."}`
        : `Before applying ${options.step}, save a separate copy of your edits and reconcile the named target with the baseline or reviewed source, then retry.`;
      throw new Error(`${error.message} ${guidance}`, { cause: error });
    }
    const pending = changes.filter(
      (change) => !equal(change.before, change.after),
    );
    output(`${options.project} / ${options.step} — source ${source}`);
    for (const change of changes) {
      const label = equal(change.before, change.after)
        ? "ready"
        : change.after === null
          ? "remove"
          : change.before === null
            ? "create"
            : "replace";
      output(
        `  ${label}: ${change.path}${change.scripts ? ` (scripts: ${change.scripts.join(", ")})` : ""}`,
      );
    }
    if (options.dryRun) {
      output("Dry run; no files or progress changed.");
      return;
    }
    if (!pending.length && state.completed.includes(options.step)) {
      output("Already complete; no files changed.");
      return;
    }
    if (!options.yes && !(await confirm(`Apply ${options.step}?`))) {
      output(cancellationMessage);
      return;
    }
    for (const change of changes)
      requireThat(
        equal(await currentFile(root, change.path), change.before),
        `File changed during confirmation: ${change.path}; retry`,
      );
    const recovery = `${statePath}/${options.project}/recovery/${randomUUID()}`;
    const recoveryDisplay = relative(cwd, join(root, recovery));
    const journal = [];
    for (let i = 0; i < pending.length; i += 1) {
      const change = pending[i];
      const backup = change.before === null ? null : `${i}.before`;
      if (backup)
        await writeAtomic(root, `${recovery}/${backup}`, change.before);
      journal.push({
        path: change.path,
        backup,
        before: change.before === null ? null : hash(change.before),
        after: change.after === null ? null : hash(change.after),
      });
    }
    await writeAtomic(
      root,
      `${recovery}/changes.json`,
      Buffer.from(
        `${JSON.stringify({ project: options.project, step: options.step, source, files: journal }, null, 2)}\n`,
      ),
    );
    try {
      for (const change of pending) {
        requireThat(
          equal(await currentFile(root, change.path), change.before),
          `File changed before writing: ${change.path}`,
        );
        if (change.after === null) await unlink(join(root, change.path));
        else await writeTarget(root, change.path, change.after, change.mode);
      }
      if (!state.completed.includes(options.step))
        state.completed.push(options.step);
      await writeAtomic(
        root,
        projectState,
        Buffer.from(`${JSON.stringify(state, null, 2)}\n`),
      );
    } catch (error) {
      throw new Error(
        `Step interrupted: ${error.message}. Some files may already be updated. Recovery copies: ${recoveryDisplay}${sep}. Progress was not advanced; after resolving the error, rerun the same step to finish.`,
        { cause: error },
      );
    }
    output(
      `Completed ${options.step}. Recovery copies: ${recoveryDisplay}${sep}. Continue with the tutorial's next command.`,
    );
  };
  return options.dryRun ? action() : exclusive(root, cwd, action);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runTutorial(process.argv.slice(2)).catch((error) => {
    if (error instanceof ConfirmationInterrupted) {
      process.stdout.write(`${error.message}\n`);
      process.exitCode = 130;
      return;
    }
    process.stderr.write(`Tutorial step failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
