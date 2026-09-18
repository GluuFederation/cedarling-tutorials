import { z } from "zod";

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
      const response = await request("https://api.voyageai.com/v1/embeddings", {
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
        throw new Error(`Voyage request failed with status ${response.status}`);
      }
      const parsed = responseSchema.parse(await response.json());
      if (parsed.data.length !== inputs.length) {
        throw new Error("Voyage returned an unexpected embedding count");
      }
      const ordered = [...parsed.data].sort(
        (left, right) => left.index - right.index,
      );
      return ordered.map(({ embedding }, index) => {
        if (ordered[index]?.index !== index) {
          throw new Error("Voyage returned invalid embedding indexes");
        }
        if (embedding.length !== options.dimensions) {
          throw new Error(
            `Voyage returned ${embedding.length} dimensions; expected ${options.dimensions}`,
          );
        }
        return embedding;
      });
    },
  };
}
