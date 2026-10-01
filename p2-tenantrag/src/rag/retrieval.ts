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
import type { RetrievalAuthorization } from "../authorization.js";
import { FixtureRepository } from "./repository.js";
import { logRetrievalTrace, type RetrievalTrace } from "./trace.js";
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
  authorization: RetrievalAuthorization;
  trace?: (trace: RetrievalTrace) => void;
}>;

/**
 * Orchestrates the retrieval stages in security order: authorize the corpus,
 * authorize current candidate metadata, then release allowed text.
 */
export function createRetrievalService(dependencies: RetrievalDependencies) {
  const trace = dependencies.trace ?? logRetrievalTrace;
  return {
    async retrieve(
      requestId: string,
      principal: AuthenticatedPrincipal,
      request: RetrievalRequest,
    ): Promise<RetrievalResponse> {
      const corpus = dependencies.repository.findCorpus(request.corpusId);
      if (!corpus) throw corpusNotFound();
      const profile = dependencies.repository.findAccessProfile(principal.id);

      let stage = "corpus.authorization";
      try {
        if (
          !(await dependencies.authorization.authorizeCorpus(
            requestId,
            principal,
            profile,
            corpus,
          ))
        ) {
          throw corpusNotFound();
        }
        stage = "query.embedding";
        const [queryEmbedding] = await dependencies.voyage.embed(
          [request.query],
          "query",
        );
        if (!queryEmbedding)
          throw new Error("Voyage returned no query embedding");
        stage = "candidates.search";
        const candidates = await dependencies.corpusSearch.search(
          corpus.corpusId,
          queryEmbedding,
          request.limit * 3,
        );
        const documents = new Map<string, DocumentMetadata>();
        for (const candidate of candidates) {
          const document = dependencies.repository.resolveCandidate(candidate);
          documents.set(document.documentId, document);
        }

        const uniqueDocuments = [...documents.values()];
        stage = "documents.authorization";
        const decisions = await dependencies.authorization.authorizeDocuments(
          requestId,
          principal,
          profile,
          corpus,
          uniqueDocuments,
        );
        if (decisions.length !== uniqueDocuments.length)
          throw new Error("Cedarling returned an incomplete document batch");
        const allowedDocuments = new Set(
          uniqueDocuments
            .filter((_document, index) => decisions[index])
            .map((document) => document.documentId),
        );

        const selected = candidates
          .filter((candidate) => allowedDocuments.has(candidate.documentId))
          .slice(0, Math.min(request.limit, 3));
        stage = "content.load";
        const chunks = selected.map((candidate) =>
          dependencies.repository.loadChunkText(candidate.chunkId),
        );
        let answer: string | null = null;
        let selectedModel: string | null = null;
        if (chunks.length > 0) {
          stage = "answer.generate";
          const generated = await dependencies.openRouter.generate(
            request.query,
            chunks,
          );
          answer = generated.answer;
          selectedModel = generated.model;
        }

        trace({
          requestId,
          principalId: principal.id,
          candidateCount: candidates.length,
          documentAuthorizationCount: documents.size,
          loadedChunkCount: chunks.length,
          selectedModel,
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
          // Do not expose provider errors, query text, tokens, or retrieved content.
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
