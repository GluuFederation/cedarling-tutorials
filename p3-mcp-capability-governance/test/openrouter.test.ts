import { describe, expect, it, vi } from "vitest";
import { OpenRouterChatModel } from "../src/chat/openrouter.js";

describe("OpenRouter adapter", () => {
  it("uses openrouter/free and converts one bounded capability call", async () => {
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
      model: "openrouter/free",
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
      kind: "capability_call",
      name: "search_incidents",
      arguments: { query: "payment", limit: 3 },
    });
    expect(requestBody).toMatchObject({
      model: "openrouter/free",
      parallel_tool_calls: false,
      tool_choice: "required",
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

  it("rejects model text that pretends a capability was executed", async () => {
    const model = new OpenRouterChatModel({
      apiKey: "test-only-secret",
      model: "openrouter/free",
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
    ).rejects.toThrow("OpenRouter returned no capability call");
  });
});
