import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { authorizePersona } from "../src/auth/cli.js";
import { loadProjectEnvironment } from "../src/config/environment.js";
import { loadConfig } from "../src/config/project-config.js";
import { parsePersona } from "../src/incidents/types.js";
import { McpClientSession } from "../src/mcp/client.js";
import {
  searchIncidentsInput,
  updateIncidentInput,
} from "../src/mcp/schemas.js";

type Connection = Pick<McpClientSession, "callToolDirect" | "close">;
type Dependencies = Readonly<{
  loadEnvironment: () => void;
  config: typeof loadConfig;
  authorize: typeof authorizePersona;
  connect: (options: {
    endpoint: string;
    accessToken: string;
  }) => Promise<Connection>;
  confirm: (question: string) => Promise<boolean>;
  key: () => string;
  output: (message: string) => void;
  error: (message: string) => void;
}>;

const defaults: Dependencies = {
  loadEnvironment: loadProjectEnvironment,
  config: loadConfig,
  authorize: authorizePersona,
  connect: (options) => McpClientSession.connect(options),
  confirm: async (question) => {
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      return (
        (await prompt.question(`${question} [y/N] `)).trim().toLowerCase() ===
        "y"
      );
    } finally {
      prompt.close();
    }
  },
  key: randomUUID,
  output: (message) => console.log(message),
  error: (message) => console.error(message),
};

function operation(args: readonly string[], key: () => string) {
  const persona = parsePersona(args[0]);
  if (args[1] === "search" && args.length === 3) {
    return {
      persona,
      name: "search_incidents",
      arguments: searchIncidentsInput.parse({ query: args[2], limit: 5 }),
      confirmation: undefined,
    };
  }
  if (args[1] === "update" && args.length === 5) {
    const input = updateIncidentInput.parse({
      incidentId: args[2],
      expectedStatus: args[3],
      nextStatus: args[4],
      confirmed: true,
      idempotencyKey: key(),
    });
    return {
      persona,
      name: "update_incident_status",
      arguments: input,
      confirmation: `Advance ${input.incidentId} from ${input.expectedStatus} to ${input.nextStatus}?`,
    };
  }
  throw new Error("Invalid command");
}

const safeErrors = new Set([
  "authorization_denied",
  "authorization_unavailable",
  "operation_unavailable",
  "incident_not_found",
  "stale_incident_state",
  "invalid_incident_transition",
  "idempotency_conflict",
]);

/** Sends one authenticated MCP request without a model or a saved access token. */
export async function runMcpRequest(
  args: readonly string[],
  overrides: Partial<Dependencies> = {},
): Promise<number> {
  const dependencies = { ...defaults, ...overrides };
  let request: ReturnType<typeof operation>;
  try {
    request = operation(args, dependencies.key);
  } catch {
    dependencies.error(
      "Usage: pnpm exec tsx scripts/mcp-request.ts <dana|amir|eve> search <query>\n" +
        "   or: pnpm exec tsx scripts/mcp-request.ts <dana|amir|eve> update <INC-1234> <current-status> <next-status>",
    );
    return 2;
  }

  let connection: Connection | undefined;
  let exitCode = 1;
  try {
    dependencies.loadEnvironment();
    const config = dependencies.config();
    const token = await dependencies.authorize(request.persona, config);
    connection = await dependencies.connect({
      endpoint: config.mcpResource,
      accessToken: token,
    });
    if (
      request.confirmation &&
      !(await dependencies.confirm(request.confirmation))
    ) {
      dependencies.output("Status change cancelled.");
      exitCode = 0;
    } else {
      const result = await connection.callToolDirect(
        request.name,
        request.arguments,
      );
      if (result.isError) {
        const code = result.content.find(
          (item) => item.type === "text" && safeErrors.has(item.text),
        );
        dependencies.error(
          code?.type === "text" ? code.text : "operation_unavailable",
        );
      } else {
        dependencies.output(
          JSON.stringify(result.structuredContent ?? result.content, null, 2),
        );
        exitCode = 0;
      }
    }
  } catch {
    dependencies.error(
      "Direct MCP request failed. Check sign-in, service logs, and incident state before retrying.",
    );
  } finally {
    try {
      await connection?.close();
    } catch {
      dependencies.error("Could not close the MCP connection.");
      exitCode = 1;
    }
  }
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runMcpRequest(process.argv.slice(2));
}
