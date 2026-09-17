import type {
  DocumentMetadata,
  FixtureChunk,
  FixtureDocument,
  SearchCandidate,
} from "./types.js";

type Corpus = Readonly<{
  corpusId: string;
  tenantId: "tenant-a" | "tenant-b";
}>;

export class FixtureRepository {
  readonly #corpora = new Map<string, Corpus>();
  readonly #documents = new Map<string, DocumentMetadata>();
  readonly #chunks = new Map<string, FixtureChunk>();

  constructor(documents: readonly FixtureDocument[]) {
    for (const document of documents) {
      if (this.#documents.has(document.metadata.documentId)) {
        throw new Error(`Duplicate document: ${document.metadata.documentId}`);
      }
      this.#documents.set(document.metadata.documentId, document.metadata);
      const existingCorpus = this.#corpora.get(document.metadata.corpusId);
      if (
        existingCorpus &&
        existingCorpus.tenantId !== document.metadata.tenantId
      ) {
        throw new Error(
          `Corpus tenant mismatch: ${document.metadata.corpusId}`,
        );
      }
      this.#corpora.set(document.metadata.corpusId, {
        corpusId: document.metadata.corpusId,
        tenantId: document.metadata.tenantId,
      });
      for (const chunk of document.chunks) {
        if (this.#chunks.has(chunk.chunkId)) {
          throw new Error(`Duplicate chunk: ${chunk.chunkId}`);
        }
        this.#chunks.set(chunk.chunkId, chunk);
      }
    }
  }

  findCorpus(corpusId: string): Corpus | undefined {
    return this.#corpora.get(corpusId);
  }

  /** Rejects stale or substituted search IDs before protected text is released. */
  resolveCandidate(candidate: SearchCandidate): DocumentMetadata {
    const chunk = this.#chunks.get(candidate.chunkId);
    const document = this.#documents.get(candidate.documentId);
    if (
      !chunk ||
      !document ||
      chunk.documentId !== candidate.documentId ||
      chunk.corpusId !== candidate.corpusId ||
      document.corpusId !== candidate.corpusId
    ) {
      throw new Error("Candidate relationships are inconsistent");
    }
    return document;
  }

  /** The only boundary that releases protected fixture text to composition. */
  loadChunkText(chunkId: string): FixtureChunk {
    const chunk = this.#chunks.get(chunkId);
    if (!chunk) throw new Error("Chunk does not exist");
    return chunk;
  }
}
