import { describe, expect, it, vi } from "vitest";
import { createOpenRouterClient } from "../src/rag/providers/openrouter.js";
import { createVoyageClient } from "../src/rag/providers/voyage.js";
import type { FixtureChunk } from "../src/rag/types.js";

function vector(seed: number): number[] {
  return Array.from({ length: 256 }, (_, index) => (index === seed ? 1 : 0));
}

describe("Voyage adapter", () => {
  it("sends the pinned model, input type, and dimensions", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          { index: 1, embedding: vector(1) },
          { index: 0, embedding: vector(0) },
        ],
      }),
    );
    const client = createVoyageClient({
      apiKey: "private-voyage-key",
      model: "voyage-4-lite",
      dimensions: 256,
      timeoutMs: 1_000,
      fetch: request,
    });
    await expect(
      client.embed(["first", "second"], "document"),
    ).resolves.toEqual([vector(0), vector(1)]);
    const init = request.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      input: ["first", "second"],
      input_type: "document",
      model: "voyage-4-lite",
      output_dimension: 256,
      output_dtype: "float",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer private-voyage-key",
    );
  });

  it("rejects malformed dimensions and provider failures without exposing keys", async () => {
    const malformed = createVoyageClient({
      apiKey: "never-log-this",
      model: "voyage-4-lite",
      dimensions: 256,
      timeoutMs: 1_000,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ data: [{ index: 0, embedding: [1] }] }),
        ),
    });
    await expect(malformed.embed(["text"], "query")).rejects.toMatchObject({
      provider: "voyage",
      reason: "invalid_response",
      httpStatus: 200,
    });

    const unavailable = createVoyageClient({
      apiKey: "never-log-this",
      model: "voyage-4-lite",
      dimensions: 256,
      timeoutMs: 1_000,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 429 })),
    });
    await expect(unavailable.embed(["text"], "query")).rejects.not.toThrow(
      "never-log-this",
    );
    await expect(
      unavailable.embed(Array(257).fill("text"), "document"),
    ).rejects.toThrow("1 to 256");
    await expect(unavailable.embed([""], "query")).rejects.toThrow(
      "1 to 500 characters",
    );
    await expect(
      unavailable.embed(["x".repeat(501)], "document"),
    ).rejects.toThrow("1 to 500 characters");
  });

  it("surfaces bounded request timeouts without exposing the key", async () => {
    const client = createVoyageClient({
      apiKey: "never-log-this",
      model: "voyage-4-lite",
      dimensions: 256,
      timeoutMs: 1_000,
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    });
    await expect(client.embed(["text"], "query")).rejects.toMatchObject({
      provider: "voyage",
      reason: "timeout",
    });
    await expect(client.embed(["text"], "query")).rejects.not.toThrow(
      "never-log-this",
    );
  });
});

describe.each(["voyage", "openrouter"] as const)(
  "%s safe failures",
  (provider) => {
    function execute(transport: typeof fetch) {
      const options = {
        apiKey: "private-key",
        timeoutMs: 1_000,
        fetch: transport,
      };
      return provider === "voyage"
        ? createVoyageClient({
            ...options,
            model: "voyage-4-lite",
            dimensions: 256,
          }).embed(["private-query"], "query")
        : createOpenRouterClient({
            ...options,
            model: "openrouter/free",
          }).generate("private-query", [
            {
              chunkId: "a-1",
              documentId: "a",
              corpusId: "tenant-a-support",
              text: "private-evidence",
            },
          ]);
    }

    it.each([401, 403, 429, 503])(
      "retains HTTP %s without the response body",
      async (status) => {
        const error = await execute(
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response("private-body", { status })),
        ).catch((error: unknown) => error);
        expect(error).toMatchObject({
          provider,
          reason: "http_error",
          httpStatus: status,
        });
        expect(String(error) + JSON.stringify(error)).not.toMatch(
          /private-(body|key|query|evidence)/,
        );
      },
    );

    it.each([
      [new DOMException("private-query", "TimeoutError"), "timeout"],
      [new TypeError("private-key"), "network_error"],
    ])(
      "classifies transport failures without retaining their messages",
      async (cause, reason) => {
        const error = await execute(
          vi.fn<typeof fetch>().mockRejectedValue(cause),
        ).catch((error: unknown) => error);
        expect(error).toMatchObject({ provider, reason });
        expect(error).not.toHaveProperty("httpStatus", expect.anything());
        expect(String(error) + JSON.stringify(error)).not.toMatch(
          /private-(key|query)/,
        );
      },
    );

    it.each([
      "not-json private-body",
      JSON.stringify({ private: "private-evidence" }),
    ])("rejects malformed responses safely", async (body) => {
      const error = await execute(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      ).catch((error: unknown) => error);
      expect(error).toMatchObject({
        provider,
        reason: "invalid_response",
        httpStatus: 200,
      });
      expect(String(error) + JSON.stringify(error)).not.toMatch(
        /private-(body|evidence)/,
      );
    });
  },
);

describe("OpenRouter adapter", () => {
  const chunk: FixtureChunk = {
    chunkId: "a-public-1",
    documentId: "a-public",
    corpusId: "tenant-a-support",
    text: "Synthetic evidence only.",
  };

  it("uses the free router and returns the selected model", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "vendor/free-model",
        choices: [{ message: { content: " Grounded answer. " } }],
      }),
    );
    const client = createOpenRouterClient({
      apiKey: "private-openrouter-key",
      model: "openrouter/free",
      timeoutMs: 1_000,
      fetch: request,
    });
    await expect(client.generate("Question?", [chunk])).resolves.toEqual({
      answer: "Grounded answer.",
      model: "vendor/free-model",
    });
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
      model: string;
      max_completion_tokens: number;
      reasoning: { effort: string; exclude: boolean };
      provider: { max_price: { prompt: number; completion: number } };
      messages: Array<{ content: string }>;
    };
    expect(body.model).toBe("openrouter/free");
    expect(body.max_completion_tokens).toBe(512);
    expect(body.reasoning).toEqual({ effort: "minimal", exclude: true });
    expect(body.provider.max_price).toEqual({ prompt: 0, completion: 0 });
    expect(body.messages[1]?.content).toContain("a-public-1");
    expect(body.messages[1]?.content).toContain("Synthetic evidence only.");
  });

  it("removes the zero-price cap only when paid routing is enabled", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        model: "vendor/selected-model",
        choices: [{ message: { content: "Grounded answer." } }],
      }),
    );
    const client = createOpenRouterClient({
      apiKey: "test-key",
      model: "vendor/selected-model",
      allowPaid: true,
      timeoutMs: 1_000,
      fetch: request,
    });
    await client.generate("Question?", [chunk]);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "vendor/selected-model",
    });
    expect(
      JSON.parse(String(request.mock.calls[0]?.[1]?.body)),
    ).not.toHaveProperty("provider.max_price");
  });

  it("bounds evidence and rejects malformed responses", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ choices: [] }));
    const client = createOpenRouterClient({
      apiKey: "secret",
      model: "openrouter/free",
      timeoutMs: 1_000,
      fetch: transport,
    });
    await expect(client.generate("Question?", [])).rejects.toThrow("1 to 3");
    await expect(client.generate("", [chunk])).rejects.toThrow(
      "1 to 500 characters",
    );
    await expect(
      client.generate("Question?", [{ ...chunk, text: "x".repeat(401) }]),
    ).rejects.toThrow("1 to 400 characters");
    expect(transport).not.toHaveBeenCalled();
    await expect(client.generate("Question?", [chunk])).rejects.toMatchObject({
      provider: "openrouter",
      reason: "invalid_response",
      httpStatus: 200,
    });
  });

  it.each([null, "", "   "])(
    "distinguishes empty answer %j from a malformed response",
    async (content) => {
      const client = createOpenRouterClient({
        apiKey: "private-key",
        model: "openrouter/free",
        timeoutMs: 1_000,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            model: "vendor/free-model",
            choices: [{ message: { content } }],
          }),
        ),
      });
      await expect(client.generate("Question?", [chunk])).rejects.toMatchObject(
        { provider: "openrouter", reason: "empty_answer", httpStatus: 200 },
      );
    },
  );

  it.each([429, "private-provider-code", undefined])(
    "recognizes HTTP-200 error envelopes with code %j",
    async (code) => {
      const client = createOpenRouterClient({
        apiKey: "private-key",
        model: "openrouter/free",
        timeoutMs: 1_000,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            error: { code, message: "private-provider-body" },
          }),
        ),
      });
      const error = await client
        .generate("Question?", [chunk])
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        provider: "openrouter",
        reason: "provider_error",
        httpStatus: 200,
        providerCode: typeof code === "number" ? code : undefined,
      });
      expect(String(error) + JSON.stringify(error)).not.toContain("private-");
    },
  );
});
