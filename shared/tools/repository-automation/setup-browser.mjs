// Installs Chromium on disposable GitHub Ubuntu runners with bounded network setup.
import { execFileSync, spawn } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function hardenSources(text) {
  return text
    .replace(
      /https?:\/\/(?:azure\.archive|archive)\.ubuntu\.com\/ubuntu(?=[/\s]|$)/g,
      "https://archive.ubuntu.com/ubuntu",
    )
    .replace(
      /http:\/\/security\.ubuntu\.com\/ubuntu(?=[/\s]|$)/g,
      "https://security.ubuntu.com/ubuntu",
    );
}

function transient(error) {
  const text = error.message;
  if (
    /signature|NO_PUBKEY|BADSIG|EXPKEYSIG|Hash Sum mismatch|dpkg|certificate|CERT_|timed out|cancelled|Unable to locate|no installation candidate/i.test(
      text,
    )
  )
    return false;
  return /Temporary failure resolving|Could not resolve|Could not connect|Connection (?:reset|failed|refused)|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|socket hang up|\b(?:429|50[234])\b/.test(
    text,
  );
}

export async function installBrowser({ install, report = () => {} }) {
  let dependenciesReady = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = performance.now();
    for (const phase of dependenciesReady
      ? ["browser"]
      : ["dependencies", "browser"]) {
      const phaseStarted = performance.now();
      try {
        const remaining = 180_000 - (performance.now() - started);
        if (remaining <= 0) throw new Error("Browser setup timed out");
        await install(phase, remaining);
        if (phase === "dependencies") dependenciesReady = true;
        report({
          phase,
          attempt,
          result: "success",
          seconds: Math.ceil((performance.now() - phaseStarted) / 1000),
        });
      } catch (error) {
        report({
          phase,
          attempt,
          result: "failure",
          seconds: Math.ceil((performance.now() - phaseStarted) / 1000),
        });
        if (attempt === 2 || !transient(error)) throw error;
        break;
      }
      if (phase === "browser") return;
    }
  }
}

async function prepareUbuntu() {
  let found = false;
  for (const path of [
    "/etc/apt/sources.list.d/ubuntu.sources",
    "/etc/apt/sources.list",
  ]) {
    let before;
    try {
      before = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (
      /https?:\/\/(?:azure\.archive|archive|security)\.ubuntu\.com\/ubuntu/.test(
        before,
      )
    )
      found = true;
    const after = hardenSources(before);
    if (after !== before)
      execFileSync("sudo", ["-n", "tee", path], {
        input: after,
        stdio: ["pipe", "ignore", "pipe"],
      });
  }
  if (!found)
    throw new Error("Expected official Ubuntu package sources on this runner");
  execFileSync("sudo", ["-n", "tee", "/etc/apt/apt.conf.d/99tutorial-ci"], {
    input:
      'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "0";\nDpkg::Use-Pty "0";\n',
    stdio: ["pipe", "ignore", "pipe"],
  });
}

export function installPhase(
  phase,
  budget,
  { cli = resolve("node_modules/@playwright/test/cli.js"), signal } = {},
) {
  if (signal?.aborted)
    return Promise.reject(new Error("Browser setup cancelled"));
  const timeout = [
    "timeout",
    "--signal=TERM",
    "--kill-after=10s",
    `${Math.max(1, Math.floor(budget / 1000))}s`,
    process.execPath,
    cli,
  ];
  const command = phase === "dependencies" ? "sudo" : timeout.shift();
  const args =
    phase === "dependencies"
      ? ["-n", ...timeout, "install-deps", "chromium"]
      : [...timeout, "install", "chromium"];
  return new Promise((done, reject) => {
    // Root's timeout owns the APT process group; the browser download runs as the runner user.
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ||
          join(homedir(), ".cache", "ms-playwright"),
        PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "30000",
      },
    });
    let output = "";
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    signal?.addEventListener("abort", stop, { once: true });
    const clean = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      signal?.removeEventListener("abort", stop);
    };
    const copy = (stream) => (bytes) => {
      output = (output + bytes.toString()).slice(-128 * 1024);
      stream.write(bytes);
    };
    child.stdout.on("data", copy(process.stdout));
    child.stderr.on("data", copy(process.stderr));
    child.once("error", (error) => {
      clean();
      reject(error);
    });
    child.once("close", (code, signal) => {
      clean();
      if (cancelled) reject(new Error("Browser setup cancelled"));
      else if (code === 124 || code === 137)
        reject(new Error("Browser setup timed out"));
      else if (code !== 0)
        reject(
          new Error(
            `Browser ${phase} setup failed (${code ?? signal}): ${output}`,
          ),
        );
      else done();
    });
  });
}

if (import.meta.main) {
  try {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.RUNNER_OS !== "Linux" ||
      process.platform !== "linux"
    )
      throw new Error(
        "Browser system setup is restricted to disposable GitHub Linux runners",
      );
    await prepareUbuntu();
    const rows = [];
    try {
      await installBrowser({
        install: installPhase,
        report: (row) => {
          rows.push(row);
          console.info(
            `Browser setup: ${row.phase}, attempt ${row.attempt}, ${row.result}, ${row.seconds}s`,
          );
        },
      });
    } finally {
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `### Browser setup\n\n| Phase | Attempt | Result | Seconds |\n|---|---:|---|---:|\n${rows.map((row) => `| ${row.phase} | ${row.attempt} | ${row.result} | ${row.seconds} |`).join("\n")}\n`,
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
