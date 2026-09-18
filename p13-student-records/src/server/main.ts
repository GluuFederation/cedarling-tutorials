import { buildApp } from "./app.ts";
import { loadConfig, prepareData } from "./config.ts";
import { SchoolDatabase } from "./database.ts";
import { createOidc } from "./oidc.ts";

process.umask(0o077);
console.info("P13 authorization: FAKE ALLOW; Cedarling is not called.");

const config = loadConfig();
const database = new SchoolDatabase(prepareData(config), config.issuer);
try {
  const oidc = await createOidc(config);
  const server = buildApp({ config, database, oidc }).listen(
    config.port,
    config.host,
  );
  server.once("listening", () =>
    console.info(`P13 CedarSchool listening at ${config.baseUrl}`),
  );
  server.once("error", (error) => {
    console.error(
      "P13 could not listen; check whether its loopback port is already in use.",
      "code" in error ? error.code : "LISTEN_FAILED",
    );
    database.close();
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close((error) => {
      database.close();
      process.exitCode = error ? 1 : 0;
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      console.info(`Received ${signal}; stopping P13 CedarSchool`);
      stop();
    });
} catch {
  database.close();
  console.error(
    "P13 startup failed. Check the local IdP and configuration; no protected service was started.",
  );
  process.exitCode = 1;
}
