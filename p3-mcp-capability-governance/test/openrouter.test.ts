import { describe, expect, it, vi } from "vitest";
import { OpenRouterChatModel } from "../src/chat/openrouter.js";

describe("OpenRouter adapter", () => {
  const messages = [{ role: "user" as const, content: "private prompt" }];
  const tools = [
    {
      kind: "tool" as const,
      name: "search_incidents",
      description: "Search incidents",
      inputSchema: { type: "object" },
    },
  ];

  it.each([
    [401, "provider_auth"],
    [400, "provider_rejected"],
    [403, "provider_rejected"],
    [404, "provider_unavailable"],
    [402, "provider_quota"],
    [429, "provider_quota"],
    [503, "provider_unavailable"],
  ] as const)(
    "reports HTTP %s without exposing the provider body",
    async (status, code) => {
      const model = new OpenRouterChatModel({
        apiKey: "private-key",
        model: "liquid/lfm-2.5-2.6b:free",
        timeoutMs: 1000,
        fetch: async () =>
          new Response("private provider diagnostics", { status }),
      });
      try {
        await model.next(messages, tools);
        expect.fail("Expected provider failure");
      } catch (error) {
        expect(error).toMatchObject({ code, httpStatus: status });
        expect(String(error)).not.toMatch(/private/);
      }
    },
  );

  it.each([
    [
      new DOMException("private diagnostics", "TimeoutError"),
      "provider_timeout",
    ],
    [new TypeError("private diagnostics"), "provider_network"],
  ] as const)("classifies fetch failure as %s", async (failure, code) => {
    const model = new OpenRouterChatModel({
      apiKey: "private-key",
      model: "liquid/lfm-2.5-2.6b:free",
      timeoutMs: 1000,
      fetch: async () => {
        throw failure;
      },
    });
    await expect(model.next(messages, tools)).rejects.toMatchObject({ code });
  });

  it("recognizes an error returned inside HTTP 200", async () => {
    const model = new OpenRouterChatModel({
      apiKey: "private-key",
      model: "liquid/lfm-2.5-2.6b:free",
      timeoutMs: 1000,
      fetch: async () =>
        Response.json({ error: { code: 429, message: "private diagnostics" } }),
    });
    await expect(model.next(messages, tools)).rejects.toMatchObject({
      code: "provider_quota",
      httpStatus: 200,
    });
  });

  it.each([
    "not JSON",
    "[]",
    "null",
    '{"choices":[]}',
    ...[null, "", "   "].map((content) =>
      JSON.stringify({ choices: [{ message: { content } }] }),
    ),
    ...["not JSON", "[]", "null"].map((arguments_) =>
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: { name: "search_incidents", arguments: arguments_ },
                },
              ],
            },
          },
        ],
      }),
    ),
    JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: ["INC-1001", "INC-1002"].map((query) => ({
              function: {
                name: "search_incidents",
                arguments: JSON.stringify({ query }),
              },
            })),
          },
        },
      ],
    }),
  ])("rejects malformed model output without echoing it", async (body) => {
    const model = new OpenRouterChatModel({
      apiKey: "private-key",
      model: "liquid/lfm-2.5-2.6b:free",
      timeoutMs: 1000,
      fetch: async () => new Response(body),
    });
    await expect(model.next(messages, tools)).rejects.toMatchObject({
      code: "invalid_model_response",
    });
  });
  it("requests a zero-cost tool-capable provider and converts one bounded capability call", async () => {
    let requestBody: unknown;
    const request = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON request body");
        }
        requestBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      function: {
                        name: "search_incidents",
                        arguments: '{"query":"payment","limit":3}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    const model = new OpenRouterChatModel({
      apiKey: "test-only-secret",
      model: "liquid/lfm-2.5-2.6b:free",
      timeoutMs: 1_000,
      fetch: request,
    });
    const result = await model.next(
      [{ role: "user", content: "Find the payment incident." }],
      [
        {
          kind: "tool",
          name: "search_incidents",
          description: "Search incidents",
          inputSchema: { type: "object" },
        },
      ],
    );

    expect(result).toEqual({
      name: "search_incidents",
      arguments: { query: "payment", limit: 3 },
    });
    expect(requestBody).toEqual({
      model: "liquid/lfm-2.5-2.6b:free",
      tool_choice: "auto",
      provider: {
        require_parameters: true,
        max_price: { prompt: 0, completion: 0 },
      },
      tools: [
        {
          type: "function",
          function: {
            name: "search_incidents",
            description: "Search incidents",
            parameters: { type: "object" },
          },
        },
      ],
      messages: [
        {
          role: "system",
          content: expect.stringContaining(
            "Never claim that a capability ran unless you request its tool",
          ),
        },
        { role: "user", content: "Find the payment incident." },
      ],
    });
  });

  it("uses the selected paid model only when explicitly enabled", async () => {
    let requestBody: unknown;
    const model = new OpenRouterChatModel({
      apiKey: "test-key",
      model: "vendor/selected-model",
      allowPaid: true,
      timeoutMs: 1_000,
      fetch: async (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Missing body");
        requestBody = JSON.parse(init.body);
        return Response.json({
          choices: [{ message: { content: "No action." } }],
        });
      },
    });
    await model.next(messages, tools);
    expect(requestBody).toMatchObject({
      model: "vendor/selected-model",
      provider: { require_parameters: true },
    });
    expect(requestBody).not.toHaveProperty("provider.max_price");
  });

  it.each([[undefined], [null], [[]]])(
    "accepts a text-only response with tool_calls=%j as no operation",
    async (toolCalls) => {
      const model = new OpenRouterChatModel({
        apiKey: "test-only-secret",
        model: "liquid/lfm-2.5-2.6b:free",
        timeoutMs: 1000,
        fetch: async () =>
          Response.json({
            choices: [
              { message: { content: "Hello!", tool_calls: toolCalls } },
            ],
          }),
      });
      await expect(
        model.next([{ role: "user", content: "Hi, how are you?" }], tools),
      ).resolves.toBeNull();
    },
  );

  it("does not interpret model text as an executed operation", async () => {
    const model = new OpenRouterChatModel({
      apiKey: "test-only-secret",
      model: "liquid/lfm-2.5-2.6b:free",
      timeoutMs: 1_000,
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '{"incidentId":"INC-1001","nextStatus":"investigating"}',
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    });

    await expect(
      model.next(
        [
          {
            role: "user",
            content: "Advance INC-1001 from open to investigating.",
          },
        ],
        [
          {
            kind: "tool",
            name: "update_incident_status",
            description: "Update incident status",
            inputSchema: { type: "object" },
          },
        ],
      ),
    ).resolves.toBeNull();
  });
});
