import { spawn } from "node:child_process";
import { isolatedState, proveNormal, ready } from "./scenario-support.ts";

const state = await isolatedState();
async function compose(...args: string[]) {
  const child = spawn(
    "docker",
    [
      "compose",
      "--env-file",
      state.envFile,
      "--project-name",
      state.project,
      "-f",
      "compose.yaml",
      ...args,
    ],
    { stdio: "inherit" },
  );
  await new Promise<void>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(new Error(`Owned Compose ${args[0]} failed (${code})`)),
    );
  });
}
try {
  await compose("config", "--quiet");
  await compose("up", "--build", "--wait", "--wait-timeout", "120", "-d");
  await ready(`${state.baseUrl}/health`);
  await compose(
    "exec",
    "-T",
    "cedarmarket",
    "node",
    "-e",
    "const assert=require('node:assert/strict'),fs=require('node:fs');assert.notEqual(process.getuid(),0);for(const file of ['/data/session-key','/data/market.sqlite'])assert.equal(fs.statSync(file).mode&0o077,0);",
  );
  const proof = await proveNormal(state);
  await compose("restart", "cedarmarket");
  await ready(`${state.baseUrl}/health`);
  await proof.persisted();
  console.info(
    "P15 isolated Docker/OIDC permissive and restart persistence passed.",
  );
} finally {
  await compose("down", "--remove-orphans", "--volumes");
  state.cleanup();
}
