import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createOidc } from "./oidc.ts";
import { openState } from "./prepare-data.ts";

process.umask(0o077);
console.info("P15 authorization: FAKE ALLOW; Cedarling is not called.");
const config = loadConfig();
const { key, store } = openState(config.dataDir);
const oidc = await createOidc(config);
const server = createApp(config, store, key, oidc).listen(
  config.port,
  config.host,
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => store.close());
  server.closeIdleConnections();
}
server.once("error", () => {
  console.error(
    "P15 listener unavailable; check its configured loopback port.",
  );
  process.exitCode = 1;
  stop();
});
server.once("listening", () =>
  console.info(`P15 CedarMarket listening at ${config.baseUrl}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    console.info(`Received ${signal}; stopping P15 CedarMarket`);
    stop();
  });
