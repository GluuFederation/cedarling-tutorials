import { z } from "zod";
import { ProviderError } from "./errors.js";

export type VoyageInputType = "document" | "query";

export type VoyageClient = Readonly<{
  embed: (
    inputs: readonly string[],
    inputType: VoyageInputType,
  ) => Promise<readonly (readonly number[])[]>;
}>;

type VoyageClientOptions = Readonly<{
  apiKey: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
  fetch?: typeof fetch;
}>;

const responseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number().finite()),
      index: z.number().int().nonnegative(),
    }),
  ),
});

export function createVoyageClient(options: VoyageClientOptions): VoyageClient {
  const request = options.fetch ?? fetch;
  return {
    async embed(inputs, inputType) {
      if (inputs.length === 0 || inputs.length > 256) {
        throw new Error("Voyage requests require 1 to 256 inputs");
      }
      if (
        inputs.some((input) => input.trim().length === 0 || input.length > 500)
      ) {
        throw new Error("Voyage inputs require 1 to 500 characters");
      }
      let response: Response | undefined;
      let body: unknown;
      try {
        response = await request("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: inputs,
            input_type: inputType,
            model: options.model,
            output_dimension: options.dimensions,
            output_dtype: "float",
          }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!response.ok) {
          throw new ProviderError("voyage", "http_error", response.status);
        }
        body = await response.json();
      } catch (error) {
        throw ProviderError.fromTransport("voyage", error, response?.status);
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success || parsed.data.data.length !== inputs.length) {
        throw new ProviderError("voyage", "invalid_response", response.status);
      }
      const ordered = [...parsed.data.data].sort(
        (left, right) => left.index - right.index,
      );
      return ordered.map(({ embedding }, index) => {
        if (
          ordered[index]?.index !== index ||
          embedding.length !== options.dimensions
        ) {
          throw new ProviderError(
            "voyage",
            "invalid_response",
            response.status,
          );
        }
        return embedding;
      });
    },
  };
}
