export type ChatMessage = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

export type ModelTool = Readonly<{
  kind: "tool" | "resource" | "prompt";
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}>;

export type ModelResponse =
  | Readonly<{ kind: "message"; text: string }>
  | Readonly<{
      kind: "capability_call";
      name: string;
      arguments: Readonly<Record<string, unknown>>;
    }>;

export interface ChatModel {
  next(
    messages: readonly ChatMessage[],
    tools: readonly ModelTool[],
  ): Promise<ModelResponse>;
}

/** Deterministic model used by tests while preserving the real host path. */
export class ScriptedChatModel implements ChatModel {
  #responses: ModelResponse[];

  constructor(responses: readonly ModelResponse[]) {
    this.#responses = [...responses];
  }

  async next(): Promise<ModelResponse> {
    const response = this.#responses.shift();
    if (!response) throw new Error("Scripted chat model has no next response");
    return response;
  }
}
