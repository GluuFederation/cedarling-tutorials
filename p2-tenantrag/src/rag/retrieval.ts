import { performance } from "node:perf_hooks";
import {
  ApplicationError,
  corpusNotFound,
  retrievalUnavailable,
} from "../errors.js";
import type { CorpusSearch } from "./corpus.js";
import type { OpenRouterClient } from "./providers/openrouter.js";
import type { VoyageClient } from "./providers/voyage.js";
import { ProviderError } from "./providers/errors.js";
import type { AuthenticatedPrincipal } from "../auth/authenticator.js";
import { FixtureRepository } from "./repository.js";
import { logPermissiveTrace, type PermissiveTrace } from "./trace.js";
import type { DocumentMetadata, RetrievalResponse } from "./types.js";

export type RetrievalRequest = Readonly<{
  corpusId: string;
  query: string;
  limit: number;
}>;

type RetrievalDependencies = Readonly<{
  repository: FixtureRepository;
  corpusSearch: CorpusSearch;
  voyage: VoyageClient;
  openRouter: OpenRouterClient;
  trace?: (trace: PermissiveTrace) => void;
}>;

function elapsed(start: number): number {
  return performance.now() - start;
}

/**
 * Orchestrates the retrieval stages in security order: resolve trusted metadata,
 * reach both authorization seams, then release protected text for generation.
 */
export function createRetrievalService(dependencies: RetrievalDependencies) {
  const trace = dependencies.trace ?? logPermissiveTrace;
  return {
    async retrieve(
      requestId: string,
      principal: AuthenticatedPrincipal,
      request: RetrievalRequest,
    ): Promise<RetrievalResponse> {
      const started = performance.now();
      const corpus = dependencies.repository.findCorpus(request.corpusId);
      if (!corpus) throw corpusNotFound();

      let stage = "corpus.search";
      try {
        // CEDARLING_INTEGRATION_POINT:
        // Authorize RAG::SearchCorpus here before embedding the query or searching Orama.
        stage = "query.embedding";
        const embeddingStarted = performance.now();
        const [queryEmbedding] = await dependencies.voyage.embed(
          [request.query],
          "query",
        );
        if (!queryEmbedding)
          throw new Error("Voyage returned no query embedding");
        const queryEmbeddingMs = elapsed(embeddingStarted);

        const searchStarted = performance.now();
        stage = "candidates.search";
        const candidates = await dependencies.corpusSearch.search(
          corpus.corpusId,
          queryEmbedding,
          request.limit * 3,
        );
        const searchMs = elapsed(searchStarted);

        const metadataStarted = performance.now();
        stage = "document.retrieve";
        const documents = new Map<string, DocumentMetadata>();
        for (const candidate of candidates) {
          const document = dependencies.repository.resolveCandidate(candidate);
          documents.set(document.documentId, document);
        }

        const allowedDocuments = new Set<string>();
        for (const document of documents.values()) {
          // CEDARLING_INTEGRATION_POINT:
          // Authorize RAG::RetrieveDocument here from current document metadata
          // before loading any chunk text.
          allowedDocuments.add(document.documentId);
        }

        const selected = candidates
          .filter((candidate) => allowedDocuments.has(candidate.documentId))
          .slice(0, Math.min(request.limit, 3));
        stage = "content.load";
        const chunks = selected.map((candidate) =>
          dependencies.repository.loadChunkText(candidate.chunkId),
        );
        const metadataMs = elapsed(metadataStarted);

        let answer: string | null = null;
        let selectedModel: string | null = null;
        let generationMs = 0;
        if (chunks.length > 0) {
          stage = "answer.generate";
          const generationStarted = performance.now();
          const generated = await dependencies.openRouter.generate(
            request.query,
            chunks,
          );
          generationMs = elapsed(generationStarted);
          answer = generated.answer;
          selectedModel = generated.model;
        }

        trace({
          requestId,
          principalId: principal.id,
          candidates: candidates.map(({ documentId, chunkId }) => ({
            documentId,
            chunkId,
          })),
          documentAuthorizationCount: documents.size,
          loadedChunkCount: chunks.length,
          selectedModel,
          timings: {
            queryEmbeddingMs,
            searchMs,
            metadataMs,
            generationMs,
            totalMs: elapsed(started),
          },
        });

        return {
          requestId,
          answer,
          citations: chunks.map((chunk) => ({
            documentId: chunk.documentId,
            chunkId: chunk.chunkId,
            label: documents.get(chunk.documentId)?.title ?? chunk.documentId,
          })),
        };
      } catch (error) {
        if (!(error instanceof ApplicationError) || error.statusCode >= 500) {
          console.error(
            JSON.stringify(
              {
                event: "retrieval.failed",
                requestId,
                principalId: principal.id,
                stage,
                category: "retrieval_unavailable",
                ...(error instanceof ProviderError
                  ? {
                      provider: error.provider,
                      reason: error.reason,
                      httpStatus: error.httpStatus,
                      providerCode: error.providerCode,
                    }
                  : {}),
              },
              null,
              2,
            ),
          );
        }
        if (error instanceof ApplicationError) {
          throw error;
        }
        throw retrievalUnavailable();
      }
    },
  };
}

export type RetrievalService = ReturnType<typeof createRetrievalService>;
