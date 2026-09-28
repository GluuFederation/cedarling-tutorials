import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type GetPromptResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/client";
import type { ModelTool } from "../chat/model.js";
import { MCP_PROTOCOL_VERSION } from "../config/project-config.js";

type ClientSessionOptions = Readonly<{
  endpoint: string;
  accessToken: string;
  fetch?: typeof fetch;
}>;

function promptSchema(
  arguments_: readonly Readonly<{ name: string; required?: boolean }>[] = [],
): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    properties: Object.fromEntries(
      arguments_.map(({ name }) => [name, { type: "string" }]),
    ),
    required: arguments_
      .filter(({ required }) => required)
      .map(({ name }) => name),
    additionalProperties: false,
  };
}
const hostManagedArguments = new Set(["confirmed", "idempotencyKey"]);

/** Removes transport and safety values that the trusted host supplies itself. */
function modelInputSchema(
  name: string,
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (name !== "update_incident_status") return schema;
  const properties =
    typeof schema.properties === "object" && schema.properties !== null
      ? (schema.properties as Readonly<Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (property): property is string =>
          typeof property === "string" && !hostManagedArguments.has(property),
      )
    : [];
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(properties).filter(
        ([property]) => !hostManagedArguments.has(property),
      ),
    ),
    required,
  };
}

/** Owns one modern, exactly pinned MCP client connection. */
export class McpClientSession {
  readonly #client: Client;
  #surface = new Map<string, ModelTool & Readonly<{ uri?: string }>>();

  private constructor(client: Client) {
    this.#client = client;
  }

  static async connect(
    options: ClientSessionOptions,
  ): Promise<McpClientSession> {
    const client = new Client(
      { name: "p3-terminal-host", version: "0.0.1" },
      {
        supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
        versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } },
      },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(options.endpoint),
      {
        authProvider: { token: async () => options.accessToken },
        ...(options.fetch ? { fetch: options.fetch } : {}),
      },
    );
    await client.connect(transport);
    if (
      client.getProtocolEra() !== "modern" ||
      client.getNegotiatedProtocolVersion() !== MCP_PROTOCOL_VERSION
    ) {
      await client.close();
      throw new Error("MCP server did not negotiate the required protocol");
    }
    return new McpClientSession(client);
  }

  async discover(): Promise<readonly ModelTool[]> {
    const [listedTools, listedResources, listedPrompts] = await Promise.all([
      this.#client.listTools(),
      this.#client.listResources(),
      this.#client.listPrompts(),
    ]);
    // Discovery supplies model descriptors; execution stays on the MCP server.
    const discoveredSurface = [
      ...listedTools.tools.map((tool) => ({
        kind: "tool" as const,
        name: tool.name,
        description: tool.description ?? tool.title ?? tool.name,
        inputSchema: tool.inputSchema,
      })),
      ...listedResources.resources.map((resource) => ({
        kind: "resource" as const,
        name: resource.name,
        description: resource.description ?? resource.title ?? resource.name,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        uri: resource.uri,
      })),
      ...listedPrompts.prompts.map((prompt) => ({
        kind: "prompt" as const,
        name: prompt.name,
        description: prompt.description ?? prompt.title ?? prompt.name,
        inputSchema: promptSchema(prompt.arguments),
      })),
    ];
    const modelSurface = discoveredSurface.map((descriptor) => ({
      ...descriptor,
      inputSchema: modelInputSchema(descriptor.name, descriptor.inputSchema),
    }));
    this.#surface = new Map(
      modelSurface.map((descriptor) => [descriptor.name, descriptor]),
    );

    return modelSurface;
  }

  async invoke(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
  ): Promise<CallToolResult | ReadResourceResult | GetPromptResult> {
    const descriptor = this.#surface.get(name);
    if (!descriptor)
      throw new Error("Model selected an unavailable capability");
    if (descriptor.kind === "resource") {
      if (!descriptor.uri) throw new Error("Resource URI is missing");
      return this.#client.readResource({ uri: descriptor.uri });
    }
    if (descriptor.kind === "prompt") {
      return this.#client.getPrompt({
        name: descriptor.name,
        arguments: Object.fromEntries(
          Object.entries(arguments_).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
      });
    }
    return this.#client.callTool({
      name: descriptor.name,
      arguments: arguments_,
    });
  }

  /** Calls a tool without chat-host mediation, through the same MCP endpoint. */
  callToolDirect(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
  ): Promise<CallToolResult> {
    return this.#client.callTool({ name, arguments: arguments_ });
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}
