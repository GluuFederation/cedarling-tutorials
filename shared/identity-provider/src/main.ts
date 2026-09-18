import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadTutorialEnvironment } from "./environment.js";
import { createProvider } from "./provider.js";

loadTutorialEnvironment();

const config = loadConfig();
const provider = await createProvider(config);
const app = createApp(provider);

const server = app.listen(config.port, config.host);

server.once("listening", () => {
  console.log(
    `Cedarling tutorial identity provider listening at ${config.issuer}`,
    `\nWell known path: ${provider.issuer}/.well-known/openid-configuration`,
  );
});

server.once("error", (error: NodeJS.ErrnoException) => {
  const reason =
    error.code === "EADDRINUSE" ? "address already in use" : "listener failed";
  console.error(
    `Identity provider could not listen on ${config.host}:${config.port}: ${reason}`,
  );
  process.exitCode = 1;
});

function shutDown(signal: string): void {
  console.log(`Received ${signal}; stopping identity provider`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
