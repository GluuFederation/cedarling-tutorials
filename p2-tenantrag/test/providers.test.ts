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
    await expect(malformed.embed(["text"], "query")).rejects.toThrow(
      "expected 256",
    );

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
      name: "TimeoutError",
    });
    await expect(client.embed(["text"], "query")).rejects.not.toThrow(
      "never-log-this",
    );
  });
});

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
      messages: Array<{ content: string }>;
    };
    expect(body.model).toBe("openrouter/free");
    expect(body.max_completion_tokens).toBe(512);
    expect(body.reasoning).toEqual({ effort: "minimal", exclude: true });
    expect(body.messages[1]?.content).toContain("a-public-1");
    expect(body.messages[1]?.content).toContain("Synthetic evidence only.");
  });

  it("bounds evidence and rejects malformed responses", async () => {
    const client = createOpenRouterClient({
      apiKey: "secret",
      model: "openrouter/free",
      timeoutMs: 1_000,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ choices: [] })),
    });
    await expect(client.generate("Question?", [])).rejects.toThrow("1 to 3");
    await expect(client.generate("", [chunk])).rejects.toThrow(
      "1 to 500 characters",
    );
    await expect(
      client.generate("Question?", [{ ...chunk, text: "x".repeat(401) }]),
    ).rejects.toThrow("1 to 400 characters");
    await expect(client.generate("Question?", [chunk])).rejects.toThrow();
  });
});
