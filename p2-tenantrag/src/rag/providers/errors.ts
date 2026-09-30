type Provider = "voyage" | "openrouter";
type FailureReason =
  | "http_error"
  | "provider_error"
  | "timeout"
  | "network_error"
  | "invalid_response"
  | "empty_answer";

/** Safe provider diagnostics; never retain response bodies or original errors. */
export class ProviderError extends Error {
  constructor(
    readonly provider: Provider,
    readonly reason: FailureReason,
    readonly httpStatus?: number,
    readonly providerCode?: number,
  ) {
    super(`${provider}: ${reason}`);
    this.name = "ProviderError";
  }

  static fromTransport(
    provider: Provider,
    error: unknown,
    httpStatus?: number,
  ): ProviderError {
    if (error instanceof ProviderError) return error;
    return new ProviderError(
      provider,
      error instanceof SyntaxError
        ? "invalid_response"
        : error instanceof Error &&
            ["TimeoutError", "AbortError"].includes(error.name)
          ? "timeout"
          : "network_error",
      httpStatus,
    );
  }
}
