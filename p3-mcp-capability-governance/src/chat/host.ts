import { randomUUID } from "node:crypto";
import type { McpClientSession } from "../mcp/client.js";
import type { ChatMessage, ChatModel, ModelTool } from "./model.js";

type HostDependencies = Readonly<{
  model: ChatModel;
  mcp: McpClientSession;
  confirm: (question: string) => Promise<boolean>;
  activity?: (message: string) => void;
}>;

/** Normalizes the text-bearing result shapes returned by MCP capabilities. */
function resultText(result: unknown): string {
  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;
    const groups = ["content", "contents", "messages"] as const;
    for (const group of groups) {
      const items = record[group];
      if (!Array.isArray(items)) continue;
      const texts = items
        .map((item: unknown) => {
          if (typeof item !== "object" || item === null) return undefined;
          if ("text" in item && typeof item.text === "string") return item.text;
          if (
            "content" in item &&
            typeof item.content === "object" &&
            item.content !== null &&
            "text" in item.content &&
            typeof item.content.text === "string"
          ) {
            return item.content.text;
          }
          return undefined;
        })
        .filter(
          (text: string | undefined): text is string => text !== undefined,
        );
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return "Capability completed.";
}

export class IncidentChatHost {
  readonly #dependencies: HostDependencies;
  #messages: ChatMessage[] = [];
  #tools: readonly ModelTool[] = [];

  constructor(dependencies: HostDependencies) {
    this.#dependencies = dependencies;
  }

  async connect(): Promise<void> {
    this.#tools = await this.#dependencies.mcp.discover();
    this.#dependencies.activity?.(
      `MCP discovered ${this.#tools.length} capabilities.`,
    );
  }

  async send(text: string): Promise<string> {
    this.#messages.push({ role: "user", content: text });
    const response = await this.#dependencies.model.next(
      this.#messages,
      this.#tools,
    );
    if (response.kind === "message") {
      this.#messages.push({ role: "assistant", content: response.text });
      return response.text;
    }

    const tool = this.#tools.find(({ name }) => name === response.name);
    if (!tool) throw new Error("Model selected an unavailable capability");
    const arguments_: Record<string, unknown> = { ...response.arguments };
    if (response.name === "update_incident_status") {
      const incidentId =
        typeof arguments_.incidentId === "string"
          ? arguments_.incidentId
          : "incident";
      const nextStatus =
        typeof arguments_.nextStatus === "string"
          ? arguments_.nextStatus
          : "the next status";
      const confirmed = await this.#dependencies.confirm(
        `Advance ${incidentId} to ${nextStatus}?`,
      );
      if (!confirmed) return "Status change cancelled.";
      arguments_.confirmed = true;
      arguments_.idempotencyKey = `turn_${randomUUID()}`;
    }

    this.#dependencies.activity?.(`MCP ${tool.kind}: ${tool.name}`);
    const result = await this.#dependencies.mcp.invoke(tool.name, arguments_);
    const textResult = resultText(result);
    this.#messages.push({ role: "assistant", content: textResult });
    return textResult;
  }
}
