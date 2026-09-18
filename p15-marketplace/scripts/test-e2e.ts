import { resolve } from "node:path";
import {
  isolatedState,
  proveGaps,
  proveNormal,
  ready,
  start,
  stop,
} from "./scenario-support.ts";

async function run(
  proof: (state: Awaited<ReturnType<typeof isolatedState>>) => Promise<unknown>,
  restart = false,
) {
  const state = await isolatedState();
  const idp = start(
    process.execPath,
    ["dist/main.js"],
    state.env,
    resolve("../shared/identity-provider"),
  );
  let app: ReturnType<typeof start> | undefined;
  try {
    await ready(`${state.issuer}/.well-known/openid-configuration`, [idp]);
    app = start(process.execPath, ["src/server/main.ts"], state.env);
    await ready(`${state.baseUrl}/health`, [idp, app]);
    const result = await proof(state);
    if (
      restart &&
      result &&
      typeof result === "object" &&
      "persisted" in result
    ) {
      await stop(app);
      app = start(process.execPath, ["src/server/main.ts"], state.env);
      await ready(`${state.baseUrl}/health`, [idp, app]);
      await (result as { persisted(): Promise<void> }).persisted();
      console.info(
        "✓ restart preserves lifecycle, sessions, and the single effect",
      );
    }
  } finally {
    if (app) await stop(app);
    await stop(idp);
    state.cleanup();
  }
}

await run(proveNormal, true);
await run(proveGaps);
console.info(
  "P15 permissive scenario passed. No real Cedarling behavior was tested.",
);
