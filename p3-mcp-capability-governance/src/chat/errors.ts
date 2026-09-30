/** Safe chat failures: provider response bodies and conversation text stay private. */
const messages = {
  provider_auth:
    "OpenRouter rejected the API key. Check P3_OPENROUTER_API_KEY.",
  provider_rejected:
    "OpenRouter rejected the request. Check account restrictions and the reported HTTP status.",
  provider_quota:
    "OpenRouter quota or rate limit reached. Check your account and retry later.",
  provider_unavailable:
    "The configured free model is unavailable. Retry later.",
  provider_timeout:
    "OpenRouter timed out. No MCP operation was requested; retry later.",
  provider_network:
    "Cannot reach OpenRouter. Check your connection; no MCP operation was requested.",
  invalid_model_response:
    "The model returned an invalid tool call. No operation ran; try again.",
  unavailable_capability:
    "The model selected an unavailable operation. No operation ran.",
  mcp_unavailable:
    "The MCP request failed. Check the service and incident state before retrying.",
} as const;

export class ChatError extends Error {
  constructor(
    readonly code: keyof typeof messages,
    readonly httpStatus?: number,
  ) {
    super(messages[code]);
    this.name = "ChatError";
  }
}
