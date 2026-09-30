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

/** A capability request, or null when the model requests no operation. */
export type ModelResponse = Readonly<{
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}> | null;

export interface ChatModel {
  next(
    messages: readonly ChatMessage[],
    tools: readonly ModelTool[],
  ): Promise<ModelResponse>;
}
