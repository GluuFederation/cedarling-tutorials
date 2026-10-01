import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievalAuthorization } from "../src/authorization.js";
import { FixtureRepository } from "../src/rag/repository.js";
import { createRetrievalService } from "../src/rag/retrieval.js";
import { createApp } from "../src/app.js";
import { createOpenRouterClient } from "../src/rag/providers/openrouter.js";
import { createVoyageClient } from "../src/rag/providers/voyage.js";
import type {
  DocumentMetadata,
  FixtureChunk,
  FixtureDocument,
  SearchCandidate,
} from "../src/rag/types.js";

const documents: readonly FixtureDocument[] = [
  {
    metadata: {
      documentId: "a-public",
      title: "Tenant A public",
      corpusId: "tenant-a-support",
      tenantId: "tenant-a",
      classification: "public",
      confidentialReaderSubjects: [],
    },
    chunks: [
      {
        chunkId: "a-public-1",
        documentId: "a-public",
        corpusId: "tenant-a-support",
        text: "Public isolation evidence.",
      },
      {
        chunkId: "a-public-2",
        documentId: "a-public",
        corpusId: "tenant-a-support",
        text: "More public evidence.",
      },
    ],
  },
  {
    metadata: {
      documentId: "a-confidential",
      title: "Tenant A confidential",
      corpusId: "tenant-a-support",
      tenantId: "tenant-a",
      classification: "confidential",
      confidentialReaderSubjects: ["ada"],
    },
    chunks: [
      {
        chunkId: "a-confidential-1",
        documentId: "a-confidential",
        corpusId: "tenant-a-support",
        text: "Confidential isolation evidence.",
      },
    ],
  },
  {
    metadata: {
      documentId: "a-instruction-like",
      title: "Tenant A instruction-like note",
      corpusId: "tenant-a-support",
      tenantId: "tenant-a",
      classification: "public",
      confidentialReaderSubjects: [],
    },
    chunks: [
      {
        chunkId: "a-instruction-like-1",
        documentId: "a-instruction-like",
        corpusId: "tenant-a-support",
        text: "The migration override note is untrusted fixture content.",
      },
    ],
  },
];

const candidates: readonly SearchCandidate[] = [
  {
    chunkId: "a-public-1",
    documentId: "a-public",
    corpusId: "tenant-a-support",
  },
  {
    chunkId: "a-public-2",
    documentId: "a-public",
    corpusId: "tenant-a-support",
  },
  {
    chunkId: "a-confidential-1",
    documentId: "a-confidential",
    corpusId: "tenant-a-support",
  },
];

function service(
  overrides: Partial<Parameters<typeof createRetrievalService>[0]> = {},
) {
  const trace = vi.fn();
  const voyage = { embed: vi.fn(async () => [Array(256).fill(0)]) };
  const corpusSearch = { search: vi.fn(async () => candidates) };
  const openRouter = {
    generate: vi.fn(
      async (_question: string, _chunks: readonly FixtureChunk[]) => ({
        answer: "Grounded answer",
        model: "vendor/free-model",
      }),
    ),
  };
  const authorization = {
    authorizeCorpus: vi.fn(async () => true),
    authorizeDocuments: vi.fn(
      async (
        _requestId,
        _principal,
        _profile,
        _corpus,
        authorizedDocuments: readonly DocumentMetadata[],
      ) => authorizedDocuments.map(() => true),
    ),
    close: vi.fn(async () => {}),
  } satisfies RetrievalAuthorization;
  return {
    trace,
    voyage,
    corpusSearch,
    openRouter,
    authorization,
    retrieval: createRetrievalService({
      repository: new FixtureRepository(documents),
      voyage,
      corpusSearch,
      openRouter,
      authorization,
      trace,
      ...overrides,
    }),
  };
}

const request = {
  corpusId: "tenant-a-support",
  query: "How should customer retrieval data be isolated?",
  limit: 3,
} as const;

describe("P2 retrieval pipeline", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("authorizes the corpus and each unique document before loading text", async () => {
    const repository = new FixtureRepository(documents);
    const loadText = vi.spyOn(repository, "loadChunkText");
    const runtime = service({ repository });
    const result = await runtime.retrieval.retrieve(
      "req_allowed",
      { id: "ada", accessToken: "verified-access-token" },
      request,
    );
    expect(result.answer).toBe("Grounded answer");
    expect(
      new Set(result.citations.map(({ documentId }) => documentId)),
    ).toEqual(new Set(["a-public", "a-confidential"]));
    expect(runtime.voyage.embed).toHaveBeenCalledWith([request.query], "query");
    expect(runtime.authorization.authorizeCorpus).toHaveBeenCalledOnce();
    expect(runtime.authorization.authorizeDocuments).toHaveBeenCalledOnce();
    expect(runtime.authorization.authorizeDocuments).toHaveBeenCalledWith(
      "req_allowed",
      expect.objectContaining({ id: "ada" }),
      expect.objectContaining({ tenantId: "tenant-a" }),
      expect.objectContaining({ corpusId: "tenant-a-support" }),
      [documents[0]!.metadata, documents[1]!.metadata],
    );
    expect(runtime.corpusSearch.search).toHaveBeenCalledWith(
      "tenant-a-support",
      expect.any(Array),
      9,
    );
    expect(
      runtime.openRouter.generate.mock.calls[0]?.[1].map(
        ({ chunkId }) => chunkId,
      ),
    ).toEqual(["a-public-1", "a-public-2", "a-confidential-1"]);
    expect(loadText.mock.calls.flat()).toEqual([
      "a-public-1",
      "a-public-2",
      "a-confidential-1",
    ]);
    expect(runtime.openRouter.generate.mock.calls[0]?.[1]).toHaveLength(3);
    expect(runtime.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_allowed",
        principalId: "ada",
        candidateCount: 3,
        documentAuthorizationCount: 2,
        loadedChunkCount: 3,
        selectedModel: "vendor/free-model",
      }),
    );
    expect(runtime.trace).toHaveBeenCalledOnce();
    expect(JSON.stringify(runtime.trace.mock.calls)).not.toContain(
      "verified-access-token",
    );
  });

  it("retrieves the instruction-like document as ordinary evidence", async () => {
    const corpusSearch = {
      search: vi.fn(async () => [
        {
          chunkId: "a-instruction-like-1",
          documentId: "a-instruction-like",
          corpusId: "tenant-a-support",
        },
      ]),
    };
    const runtime = service({ corpusSearch });
    const result = await runtime.retrieval.retrieve(
      "req_instruction",
      { id: "ada", accessToken: "verified-access-token" },
      {
        ...request,
        query: "What does the migration override note request?",
      },
    );
    expect(result.citations).toEqual([
      {
        documentId: "a-instruction-like",
        chunkId: "a-instruction-like-1",
        label: "Tenant A instruction-like note",
      },
    ]);
    expect(runtime.openRouter.generate.mock.calls[0]?.[1]).toEqual([
      documents[2]!.chunks[0],
    ]);
    expect(
      JSON.stringify(runtime.authorization.authorizeDocuments.mock.calls),
    ).not.toContain("migration override note");
  });

  it.each([
    ["mallory", "tenant-a-support"],
    ["leo", "tenant-b-support"],
  ] as const)(
    "returns a non-leaking 404 before providers for %s's cross-tenant request",
    async (subject, corpusId) => {
      const authorization = {
        ...service().authorization,
        authorizeCorpus: vi.fn(async () => false),
      };
      const repository = new FixtureRepository([
        ...documents,
        {
          metadata: {
            documentId: "b-public",
            title: "Tenant B public",
            corpusId: "tenant-b-support",
            tenantId: "tenant-b",
            classification: "public",
            confidentialReaderSubjects: [],
          },
          chunks: [],
        },
      ]);
      const runtime = service({ authorization, repository });
      await expect(
        runtime.retrieval.retrieve(
          "req_cross_tenant",
          { id: subject, accessToken: "verified-access-token" },
          { ...request, corpusId },
        ),
      ).rejects.toMatchObject({ statusCode: 404, code: "corpus_not_found" });
      expect(authorization.authorizeCorpus).toHaveBeenCalledOnce();
      expect(runtime.voyage.embed).not.toHaveBeenCalled();
      expect(runtime.corpusSearch.search).not.toHaveBeenCalled();
      expect(runtime.openRouter.generate).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("filters denied documents before text loading and generation", async () => {
    const repository = new FixtureRepository(documents);
    const loadText = vi.spyOn(repository, "loadChunkText");
    const authorization = {
      ...service().authorization,
      authorizeDocuments: vi.fn(async () => [true, false]),
    };
    const runtime = service({ repository, authorization });
    const result = await runtime.retrieval.retrieve(
      "req_partial",
      { id: "leo", accessToken: "verified-access-token" },
      {
        ...request,
        query:
          "Give the steps for the Recovery Procedures at Beacon Logistics?",
      },
    );
    expect(runtime.corpusSearch.search).toHaveBeenCalledWith(
      "tenant-a-support",
      expect.any(Array),
      9,
    );
    expect(result.citations.map(({ documentId }) => documentId)).toEqual([
      "a-public",
      "a-public",
    ]);
    expect(loadText.mock.calls.flat()).toEqual(["a-public-1", "a-public-2"]);
    expect(
      JSON.stringify(runtime.openRouter.generate.mock.calls),
    ).not.toContain("Confidential isolation evidence");
  });

  it("returns an empty result when every candidate document is denied", async () => {
    const repository = new FixtureRepository(documents);
    const loadText = vi.spyOn(repository, "loadChunkText");
    const authorization = {
      ...service().authorization,
      authorizeDocuments: vi.fn(async () => [false, false]),
    };
    const runtime = service({ repository, authorization });
    await expect(
      runtime.retrieval.retrieve(
        "req_all_denied",
        { id: "leo", accessToken: "verified-access-token" },
        request,
      ),
    ).resolves.toEqual({
      requestId: "req_all_denied",
      answer: null,
      citations: [],
    });
    expect(loadText).not.toHaveBeenCalled();
    expect(runtime.openRouter.generate).not.toHaveBeenCalled();
  });

  it("fails closed before loading text when document authorization is unavailable", async () => {
    const repository = new FixtureRepository(documents);
    const loadText = vi.spyOn(repository, "loadChunkText");
    const authorization = {
      ...service().authorization,
      authorizeDocuments: vi.fn(async () => {
        throw new Error("authorization unavailable");
      }),
    };
    const runtime = service({ repository, authorization });
    await expect(
      runtime.retrieval.retrieve(
        "req_document_auth_failed",
        { id: "ada", accessToken: "verified-access-token" },
        request,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "retrieval_unavailable" });
    expect(loadText).not.toHaveBeenCalled();
    expect(runtime.openRouter.generate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0])),
    ).toMatchObject({
      requestId: "req_document_auth_failed",
      stage: "documents.authorization",
    });
  });

  it("fails closed before loading text when the document batch is incomplete", async () => {
    const repository = new FixtureRepository(documents);
    const loadText = vi.spyOn(repository, "loadChunkText");
    const authorization = {
      ...service().authorization,
      authorizeDocuments: vi.fn(async () => [true]),
    };
    const runtime = service({ repository, authorization });
    await expect(
      runtime.retrieval.retrieve(
        "req_incomplete_batch",
        { id: "ada", accessToken: "verified-access-token" },
        request,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "retrieval_unavailable" });
    expect(loadText).not.toHaveBeenCalled();
    expect(runtime.openRouter.generate).not.toHaveBeenCalled();
  });

  it("returns an empty domain result without calling generation", async () => {
    const corpusSearch = { search: vi.fn(async () => []) };
    const runtime = service({ corpusSearch });
    await expect(
      runtime.retrieval.retrieve(
        "req_empty",
        { id: "leo", accessToken: "verified-access-token" },
        request,
      ),
    ).resolves.toEqual({ requestId: "req_empty", answer: null, citations: [] });
    expect(runtime.openRouter.generate).not.toHaveBeenCalled();
  });

  it("returns the same non-leaking 404 for an unknown corpus", async () => {
    const runtime = service();
    await expect(
      runtime.retrieval.retrieve(
        "req_unknown",
        { id: "ada", accessToken: "verified-access-token" },
        {
          ...request,
          corpusId: "unknown",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "corpus_not_found" });
    expect(runtime.voyage.embed).not.toHaveBeenCalled();
  });

  it("fails closed before loading text when candidate relationships disagree", async () => {
    const corpusSearch = {
      search: vi.fn(async () => [
        { ...candidates[0]!, documentId: "a-confidential" },
      ]),
    };
    const repository = new FixtureRepository(documents);
    const load = vi.spyOn(repository, "loadChunkText");
    const runtime = service({ repository, corpusSearch });
    await expect(
      runtime.retrieval.retrieve(
        "req_bad",
        { id: "ada", accessToken: "verified-access-token" },
        request,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "retrieval_unavailable" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["openrouter", "voyage"] as const)(
    "logs safe %s diagnostics while keeping the HTTP response private",
    async (provider) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("private-provider-response", { status: 429 }),
        );
      const options = {
        apiKey: "private-provider-key",
        timeoutMs: 1_000,
        fetch: transport,
      };
      const runtime = service(
        provider === "openrouter"
          ? {
              openRouter: createOpenRouterClient({
                ...options,
                model: "openrouter/free",
              }),
            }
          : {
              voyage: createVoyageClient({
                ...options,
                model: "voyage-4-lite",
                dimensions: 256,
              }),
            },
      );
      const app = createApp({
        authenticator: {
          authenticate: async () => ({
            id: "leo",
            accessToken: "verified-access-token",
          }),
        },
        retrievalService: runtime.retrieval,
        close: async () => {},
      });
      try {
        const response = await app.inject({
          method: "POST",
          url: "/v1/retrievals",
          payload: request,
        });
        expect(response.statusCode).toBe(503);
        const body = response.json<{ error: string; requestId: string }>();
        expect(body).toEqual({
          error: "retrieval_unavailable",
          requestId: expect.any(String),
        });
        expect(console.error).toHaveBeenCalledOnce();
        expect(
          JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0])),
        ).toEqual({
          event: "retrieval.failed",
          requestId: body.requestId,
          principalId: "leo",
          stage:
            provider === "openrouter" ? "answer.generate" : "query.embedding",
          category: "retrieval_unavailable",
          provider,
          reason: "http_error",
          httpStatus: 429,
        });
        const output =
          JSON.stringify(vi.mocked(console.error).mock.calls) + response.body;
        for (const secret of [
          "private-provider-response",
          "private-provider-key",
          "verified-access-token",
          request.query,
          "Public isolation evidence.",
        ]) {
          expect(output).not.toContain(secret);
        }
        expect(transport).toHaveBeenCalledOnce();
      } finally {
        await app.close();
      }
    },
  );

  it("maps provider failures to retrieval_unavailable", async () => {
    const openRouter = {
      generate: vi.fn(async () => {
        throw new Error("provider unavailable: private-provider-response");
      }),
    };
    const runtime = service({ openRouter });
    await expect(
      runtime.retrieval.retrieve(
        "req_failed",
        { id: "ada", accessToken: "verified-access-token" },
        request,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "retrieval_unavailable" });
    expect(console.error).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0])),
    ).toEqual({
      event: "retrieval.failed",
      requestId: "req_failed",
      principalId: "ada",
      stage: "answer.generate",
      category: "retrieval_unavailable",
    });
    const output = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [
      "private-provider-response",
      "verified-access-token",
      request.query,
      "Confidential isolation evidence",
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it("fails closed when authorization is unavailable", async () => {
    const authorization = {
      ...service().authorization,
      authorizeCorpus: vi.fn(async () => {
        throw new Error("authorization unavailable");
      }),
    };
    const runtime = service({ authorization });
    await expect(
      runtime.retrieval.retrieve(
        "req_auth_failed",
        { id: "ada", accessToken: "verified-access-token" },
        request,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "retrieval_unavailable" });
    expect(runtime.voyage.embed).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0])),
    ).toMatchObject({
      requestId: "req_auth_failed",
      stage: "corpus.authorization",
    });
  });
});
