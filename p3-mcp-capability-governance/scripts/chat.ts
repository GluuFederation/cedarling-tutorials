import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { authorizePersona } from "../src/auth/cli.js";
import { IncidentChatHost } from "../src/chat/host.js";
import { OpenRouterChatModel } from "../src/chat/openrouter.js";
import { loadProjectEnvironment } from "../src/config/environment.js";
import { loadConfig } from "../src/config/project-config.js";
import { parsePersona } from "../src/incidents/types.js";
import { McpClientSession } from "../src/mcp/client.js";
import { requireMcpServer } from "../src/mcp/availability.js";

async function main() {
  loadProjectEnvironment();
  const config = loadConfig();
  const persona = parsePersona(
    process.argv.slice(2).filter((arg) => arg !== "--")[0],
  );
  if (!config.openRouterApiKey) {
    throw new Error("P3_OPENROUTER_API_KEY is required for interactive chat");
  }

  await requireMcpServer(config.mcpResource);
  const token = await authorizePersona(persona, config);
  const mcp = await McpClientSession.connect({
    endpoint: config.mcpResource,
    accessToken: token,
  });
  const prompt = createInterface({ input: stdin, output: stdout });
  const host = new IncidentChatHost({
    model: new OpenRouterChatModel({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      timeoutMs: config.providerTimeoutMs,
    }),
    mcp,
    activity: (message) => console.error(`· ${message}`),
    confirm: async (question) =>
      (await prompt.question(`${question} [y/N] `)).trim().toLowerCase() ===
      "y",
  });

  try {
    await host.connect();
    console.log(
      "GovOps Incident Assistant. Enter one request at a time; type /quit to exit.",
    );
    while (true) {
      const message = (await prompt.question("You > ")).trim();
      if (message === "/quit") break;
      if (!message) continue;
      console.log(`Assistant > ${await host.send(message)}`);
    }
  } finally {
    prompt.close();
    await mcp.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `P3 chat stopped: ${error instanceof Error ? error.message : "unknown failure"}`,
  );
  process.exitCode = 1;
});
