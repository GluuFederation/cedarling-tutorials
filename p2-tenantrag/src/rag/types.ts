export type PersonaId = "ada" | "leo" | "mallory";

type Classification = "public" | "confidential";

export type FixtureDefinition = Readonly<{
  documentId: string;
  pdfFileName: string;
  title: string;
  corpusId: string;
  tenantId: "tenant-a" | "tenant-b";
  classification: Classification;
  expectedPageCount: number;
  expectedChunkCount: number;
  sha256: string;
}>;

export type DocumentMetadata = Readonly<
  Pick<
    FixtureDefinition,
    "documentId" | "title" | "corpusId" | "tenantId" | "classification"
  >
>;

export type FixtureChunk = Readonly<{
  chunkId: string;
  documentId: string;
  corpusId: string;
  text: string;
}>;

export type FixtureDocument = Readonly<{
  metadata: DocumentMetadata;
  chunks: readonly FixtureChunk[];
}>;

type CorpusArtifactRecord = Readonly<{
  chunkId: string;
  documentId: string;
  corpusId: string;
  embedding: readonly number[];
}>;

export type CorpusArtifact = Readonly<{
  schemaVersion: 1;
  model: string;
  dimensions: number;
  records: readonly CorpusArtifactRecord[];
}>;

export type SearchCandidate = Readonly<{
  chunkId: string;
  documentId: string;
  corpusId: string;
  score: number;
}>;

type Citation = Readonly<{
  documentId: string;
  chunkId: string;
  label: string;
}>;

export type RetrievalResponse = Readonly<{
  requestId: string;
  answer: string | null;
  citations: readonly Citation[];
}>;
