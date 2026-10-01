import { z } from "zod";
import { ChatError } from "./errors.js";
import type {
  ChatMessage,
  ChatModel,
  ModelResponse,
  ModelTool,
} from "./model.js";

const systemInstruction = `You operate the P3 Incident Assistant through the supplied MCP capabilities.
Select at most one capability, only when the latest learner message requests an incident operation.
For greetings, thanks, unrelated conversation, or requests without enough detail, reply briefly without calling a tool.
Do not repeat previous operations unless requested, or invent required arguments.
Never claim that a capability ran unless you request its tool.
Use search_incidents to find incidents, incident_response_runbook to read the runbook, triage_incident to build triage guidance, and update_incident_status to advance one incident.
The host supplies confirmation and idempotency keys; never ask the learner for them.`;

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                function: z.object({
                  name: z.string().min(1),
                  arguments: z.string(),
                }),
              }),
            )
            .max(1)
            .nullish(),
        }),
      }),
    )
    .min(1),
});

type OpenRouterOptions = Readonly<{
  apiKey: string;
  model: string;
  allowPaid?: boolean;
  timeoutMs: number;
  fetch?: typeof fetch;
}>;

function providerFailure(status: number, httpStatus = status): ChatError {
  return new ChatError(
    status === 401
      ? "provider_auth"
      : status === 402 || status === 429
        ? "provider_quota"
        : status === 404 || status >= 500
          ? "provider_unavailable"
          : "provider_rejected",
    httpStatus,
  );
}

/** Small provider adapter; prompts and credentials never enter diagnostics. */
export class OpenRouterChatModel implements ChatModel {
  readonly #options: OpenRouterOptions;

  constructor(options: OpenRouterOptions) {
    this.#options = options;
  }

  async next(
    messages: readonly ChatMessage[],
    tools: readonly ModelTool[],
  ): Promise<ModelResponse> {
    let response: Response;
    let body: unknown;
    try {
      response = await (this.#options.fetch ?? fetch)(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.#options.model,
            messages: [
              { role: "system", content: systemInstruction },
              ...messages,
            ],
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
            tool_choice: "auto",
            provider: {
              require_parameters: true,
              ...(!this.#options.allowPaid
                ? { max_price: { prompt: 0, completion: 0 } }
                : {}),
            },
          }),
          signal: AbortSignal.timeout(this.#options.timeoutMs),
        },
      );
      if (!response.ok) throw providerFailure(response.status);
      body = await response.json();
    } catch (error) {
      if (error instanceof ChatError) throw error;
      throw new ChatError(
        error instanceof SyntaxError
          ? "invalid_model_response"
          : error instanceof Error &&
              ["TimeoutError", "AbortError"].includes(error.name)
            ? "provider_timeout"
            : "provider_network",
      );
    }
    const providerError = z
      .object({ error: z.object({ code: z.number() }) })
      .safeParse(body);
    if (providerError.success)
      throw providerFailure(providerError.data.error.code, response.status);
    const parsedResponse = responseSchema.safeParse(body);
    if (!parsedResponse.success) throw new ChatError("invalid_model_response");
    const parsed = parsedResponse.data;
    const [choice] = parsed.choices;
    if (!choice) throw new ChatError("invalid_model_response");
    const message = choice.message;
    const call = message.tool_calls?.[0]?.function;
    if (!call) {
      if (!message.content?.trim())
        throw new ChatError("invalid_model_response");
      return null;
    }
    let arguments_: unknown;
    try {
      arguments_ = JSON.parse(call.arguments);
    } catch {
      throw new ChatError("invalid_model_response");
    }
    if (
      typeof arguments_ !== "object" ||
      arguments_ === null ||
      Array.isArray(arguments_)
    ) {
      throw new ChatError("invalid_model_response");
    }
    return {
      name: call.name,
      arguments: arguments_ as Record<string, unknown>,
    };
  }
}
