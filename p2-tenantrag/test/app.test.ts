import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { authenticationRequired, corpusNotFound } from "../src/errors.js";
import type { AuthenticatedPrincipal } from "../src/auth/authenticator.js";
import type {
  RetrievalRequest,
  RetrievalService,
} from "../src/rag/retrieval.js";

function application() {
  const authenticator = {
    authenticate: vi.fn(async () => ({
      id: "mallory" as const,
      accessToken: "verified-access-token",
    })),
  };
  const retrieve = vi.fn(
    async (
      requestId: string,
      _principal: AuthenticatedPrincipal,
      _request: RetrievalRequest,
    ) => ({
      requestId,
      answer: "Synthetic answer",
      citations: [],
    }),
  );
  const retrievalService = { retrieve } as unknown as RetrievalService;
  return {
    authenticator,
    retrievalService,
    retrieve,
    app: createApp({ authenticator, retrievalService }),
  };
}

describe("P2 HTTP API", () => {
  it("publishes only the two intended OpenAPI paths and capabilities", async () => {
    const runtime = application();
    const response = await runtime.app.inject({
      method: "GET",
      url: "/openapi.json",
    });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(Object.keys(document.paths)).toEqual([
      "/openapi.json",
      "/v1/retrievals",
    ]);
    expect(
      document.paths["/v1/retrievals"].post["x-cedarling-capabilities"],
    ).toEqual(["corpus.search", "document.retrieve"]);
    expect(
      document.paths["/v1/retrievals"].post.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/RetrievalResponse");
    expect(
      document.paths["/v1/retrievals"].post.responses["503"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/ErrorResponse");
    expect(
      document.components.schemas.ErrorResponse.properties.error.enum,
    ).toEqual([
      "invalid_retrieval",
      "authentication_required",
      "corpus_not_found",
      "retrieval_unavailable",
    ]);
    expect(
      document.paths["/v1/retrievals"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toMatchObject({
      required: ["corpusId", "query"],
      properties: { limit: { default: 3, minimum: 1, maximum: 3 } },
    });
  });

  it("authenticates before executing a valid retrieval", async () => {
    const runtime = application();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/retrievals",
      headers: { authorization: "Bearer token" },
      payload: {
        corpusId: "tenant-a-support",
        query: "How should customer retrieval data be isolated?",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(runtime.authenticator.authenticate).toHaveBeenCalledWith(
      "Bearer token",
    );
    expect(runtime.retrieve).toHaveBeenCalledOnce();
    expect(runtime.retrieve.mock.calls[0]?.[2]).toEqual({
      corpusId: "tenant-a-support",
      query: "How should customer retrieval data be isolated?",
      limit: 3,
    });
    expect(response.json()).toMatchObject({ answer: "Synthetic answer" });
  });

  it.each([
    ["corpusId", { query: "Question" }],
    ["query", { corpusId: "tenant-a-support" }],
  ])("requires the request %s context", async (_field, payload) => {
    const runtime = application();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/retrievals",
      headers: { authorization: "Bearer token" },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(runtime.retrieve).not.toHaveBeenCalled();
  });

  it("returns the stable 400 contract for invalid input", async () => {
    const runtime = application();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/retrievals",
      headers: { authorization: "Bearer token" },
      payload: { corpusId: "tenant-a-support", query: "", limit: 9 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_retrieval" });
    expect(runtime.retrieve).not.toHaveBeenCalled();
  });

  it("rejects an explicit limit above the three-chunk evidence bound", async () => {
    const runtime = application();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/retrievals",
      headers: { authorization: "Bearer token" },
      payload: {
        corpusId: "tenant-a-support",
        query: "Question",
        limit: 4,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(runtime.retrieve).not.toHaveBeenCalled();
  });

  it.each([
    [authenticationRequired(), 401, "authentication_required"],
    [corpusNotFound(), 404, "corpus_not_found"],
    [new Error("dependency failure"), 503, "retrieval_unavailable"],
  ])("maps errors to stable responses", async (error, status, code) => {
    const runtime = application();
    runtime.authenticator.authenticate.mockRejectedValueOnce(error);
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/retrievals",
      headers: { authorization: "Bearer token" },
      payload: {
        corpusId: "tenant-a-support",
        query: "Question",
        limit: 1,
      },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({
      error: code,
      requestId: expect.any(String),
    });
    expect(runtime.retrieve).not.toHaveBeenCalled();
  });

  it("maps an oversized JSON body to invalid_retrieval", async () => {
    const runtime = application();
    const response = await runtime.app.inject({
      method: "POST",
      url: "/v1/retrievals",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        corpusId: "tenant-a-support",
        query: "x".repeat(17_000),
        limit: 1,
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_retrieval" });
    expect(runtime.retrieve).not.toHaveBeenCalled();
  });
});
