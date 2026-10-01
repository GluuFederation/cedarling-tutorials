export type RetrievalTrace = Readonly<{
  requestId: string;
  principalId: string;
  candidateCount: number;
  documentAuthorizationCount: number;
  loadedChunkCount: number;
  selectedModel: string | null;
}>;

/** Logs bounded pipeline evidence without tokens, queries, or document text. */
export function logRetrievalTrace(trace: RetrievalTrace): void {
  console.info(
    JSON.stringify({ event: "retrieval.completed", ...trace }, null, 2),
  );
}
