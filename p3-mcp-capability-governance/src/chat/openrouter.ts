import { z } from "zod";
import type {
  ChatMessage,
  ChatModel,
  ModelResponse,
  ModelTool,
} from "./model.js";

const systemInstruction = `You operate the GovOps Incident Assistant through the supplied MCP capabilities.
Select exactly one capability for each learner request.
Never claim that a capability ran unless you request its tool.
Use list_capabilities only to list reviewed capabilities.
Use reconcile_capability_catalog only to reconcile the live and reviewed catalogs.
Use search_incidents to find incidents, incident_response_runbook to read the runbook, triage_incident to build triage guidance, and update_incident_status to advance one incident.
The host supplies discovery observations, confirmation, and idempotency keys; never ask the learner for them.`;

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
            .length(1)
            .optional(),
        }),
      }),
    )
    .min(1),
});

type OpenRouterOptions = Readonly<{
  apiKey: string;
  model: "openrouter/free";
  timeoutMs: number;
  fetch?: typeof fetch;
}>;

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
    const response = await (this.#options.fetch ?? fetch)(
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
          parallel_tool_calls: false,
          tool_choice: "required",
        }),
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      },
    );
    if (!response.ok) throw new Error("OpenRouter request failed");
    const parsed = responseSchema.parse(await response.json());
    const [choice] = parsed.choices;
    if (!choice) throw new Error("OpenRouter returned no choices");
    const message = choice.message;
    const call = message.tool_calls?.[0]?.function;
    if (!call) throw new Error("OpenRouter returned no capability call");
    const arguments_: unknown = JSON.parse(call.arguments);
    if (
      typeof arguments_ !== "object" ||
      arguments_ === null ||
      Array.isArray(arguments_)
    ) {
      throw new Error("OpenRouter returned invalid tool arguments");
    }
    return {
      kind: "capability_call",
      name: call.name,
      arguments: arguments_ as Record<string, unknown>,
    };
  }
}
