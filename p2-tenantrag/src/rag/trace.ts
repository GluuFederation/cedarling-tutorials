type RetrievalTimings = Readonly<{
  queryEmbeddingMs: number;
  searchMs: number;
  metadataMs: number;
  generationMs: number;
  totalMs: number;
}>;

export type PermissiveTrace = Readonly<{
  requestId: string;
  principalId: string;
  candidates: readonly Readonly<{ documentId: string; chunkId: string }>[];
  documentAuthorizationCount: number;
  loadedChunkCount: number;
  selectedModel: string | null;
  timings: RetrievalTimings;
}>;

/** Marks the two future server enforcement points without logging evidence. */
export function logPermissiveTrace(trace: PermissiveTrace): void {
  console.info(
    `P2 server | FAKE ALLOW | corpus.search, document.retrieve | ${trace.principalId}`,
  );
}
