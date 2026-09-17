import { describe, expect, it, vi } from "vitest";
import { FixtureRepository } from "../src/rag/repository.js";
import { createRetrievalService } from "../src/rag/retrieval.js";
import type {
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
    score: 0.99,
  },
  {
    chunkId: "a-public-2",
    documentId: "a-public",
    corpusId: "tenant-a-support",
    score: 0.98,
  },
  {
    chunkId: "a-confidential-1",
    documentId: "a-confidential",
    corpusId: "tenant-a-support",
    score: 0.97,
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
  return {
    trace,
    voyage,
    corpusSearch,
    openRouter,
    retrieval: createRetrievalService({
      repository: new FixtureRepository(documents),
      voyage,
      corpusSearch,
      openRouter,
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
  it("reproduces the cross-tenant permissive leak for Mallory", async () => {
    const repository = new FixtureRepository(documents);
    const loadText = vi.spyOn(repository, "loadChunkText");
    const runtime = service({ repository });
    const result = await runtime.retrieval.retrieve(
      "req_permissive",
      { id: "mallory", accessToken: "verified-access-token" },
      request,
    );
    expect(result.answer).toBe("Grounded answer");
    expect(
      new Set(result.citations.map(({ documentId }) => documentId)),
    ).toEqual(new Set(["a-public", "a-confidential"]));
    expect(runtime.voyage.embed).toHaveBeenCalledWith([request.query], "query");
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
        requestId: "req_permissive",
        principalId: "mallory",
        candidates: [
          { documentId: "a-public", chunkId: "a-public-1" },
          { documentId: "a-public", chunkId: "a-public-2" },
          { documentId: "a-confidential", chunkId: "a-confidential-1" },
        ],
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
          score: 1,
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

  it("maps provider failures to retrieval_unavailable", async () => {
    const openRouter = {
      generate: vi.fn(async () => {
        throw new Error("provider unavailable");
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
  });
});
