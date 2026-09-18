import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type GetPromptResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import type { RuntimeDescriptor } from "../catalog/types.js";
import type { ModelTool } from "../chat/model.js";
import { MCP_PROTOCOL_VERSION } from "../config/project-config.js";
import { resourceRequestSchema } from "./schemas.js";

const capabilityListSchema = z.object({
  capabilities: z.array(
    z.object({
      capabilityId: z.string(),
      kind: z.enum(["tool", "resource", "prompt"]),
      name: z.string(),
    }),
  ),
});

type ClientSessionOptions = Readonly<{
  endpoint: string;
  accessToken: string;
  fetch?: typeof fetch;
}>;

type Discovery = Readonly<{
  observed: readonly RuntimeDescriptor[];
  tools: readonly ModelTool[];
  reconciliation: CallToolResult;
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
function boundedSchema(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  // The SDK adds this serialization marker; governance binds the structure.
  return Object.fromEntries(
    Object.entries(schema).filter(([name]) => name !== "$schema"),
  );
}

const hostManagedArguments = new Map<string, ReadonlySet<string>>([
  ["reconcile_capability_catalog", new Set(["observed"])],
  ["update_incident_status", new Set(["confirmed", "idempotencyKey"])],
]);

/** Removes transport and safety values that the trusted host supplies itself. */
function modelInputSchema(
  name: string,
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const omitted = hostManagedArguments.get(name);
  if (!omitted) return schema;
  const properties =
    typeof schema.properties === "object" && schema.properties !== null
      ? (schema.properties as Readonly<Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (property): property is string =>
          typeof property === "string" && !omitted.has(property),
      )
    : [];
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(properties).filter(([property]) => !omitted.has(property)),
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

  async discover(): Promise<Discovery> {
    const [listedTools, listedResources, listedPrompts, capabilityResult] =
      await Promise.all([
        this.#client.listTools(),
        this.#client.listResources(),
        this.#client.listPrompts(),
        this.#client.callTool({ name: "list_capabilities", arguments: {} }),
      ]);
    const capabilityList = capabilityListSchema.parse(
      capabilityResult.structuredContent,
    );
    const reviewed = new Set(
      capabilityList.capabilities.map(({ kind, name }) => `${kind}:${name}`),
    );

    // These observations come from actual MCP list responses. They are
    // reconciliation input, never authority to register a capability.
    const discoveredSurface = [
      ...listedTools.tools.map((tool) => ({
        kind: "tool" as const,
        name: tool.name,
        description: tool.description ?? tool.title ?? tool.name,
        inputSchema: boundedSchema(tool.inputSchema),
      })),
      ...listedResources.resources.map((resource) => ({
        kind: "resource" as const,
        name: resource.name,
        description: resource.description ?? resource.title ?? resource.name,
        inputSchema: resourceRequestSchema(resource.uri),
        uri: resource.uri,
      })),
      ...listedPrompts.prompts.map((prompt) => ({
        kind: "prompt" as const,
        name: prompt.name,
        description: prompt.description ?? prompt.title ?? prompt.name,
        inputSchema: promptSchema(prompt.arguments),
      })),
    ];
    const observed: RuntimeDescriptor[] = discoveredSurface.map(
      ({ kind, name, inputSchema }) => ({
        kind,
        name,
        schema: inputSchema,
      }),
    );
    const surface = discoveredSurface.filter(({ kind, name }) =>
      reviewed.has(`${kind}:${name}`),
    );
    const modelSurface = surface.map((descriptor) => ({
      ...descriptor,
      inputSchema: modelInputSchema(descriptor.name, descriptor.inputSchema),
    }));
    this.#surface = new Map(
      modelSurface.map((descriptor) => [descriptor.name, descriptor]),
    );

    const reconciliation = await this.reconcile(observed);
    return { tools: modelSurface, reconciliation, observed };
  }

  /** Submits bounded discovery observations to the authoritative server check. */
  reconcile(observed: readonly RuntimeDescriptor[]): Promise<CallToolResult> {
    return this.#client.callTool({
      name: "reconcile_capability_catalog",
      arguments: { observed },
    });
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

  /** Used by the deterministic drift proof; it does not bypass MCP. */
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
