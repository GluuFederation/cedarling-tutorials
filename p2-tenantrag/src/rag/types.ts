export type PersonaId = "ada" | "leo" | "mallory";
export type TenantId = "tenant-a" | "tenant-b";

type Classification = "public" | "confidential";

export type AccessProfile = Readonly<{
  tenantId: TenantId;
}>;

export type FixtureDefinition = Readonly<{
  documentId: string;
  pdfFileName: string;
  title: string;
  corpusId: string;
  tenantId: TenantId;
  classification: Classification;
  confidentialReaderSubjects: readonly PersonaId[];
  expectedPageCount: number;
  expectedChunkCount: number;
  sha256: string;
}>;

export type DocumentMetadata = Readonly<
  Pick<
    FixtureDefinition,
    | "documentId"
    | "title"
    | "corpusId"
    | "tenantId"
    | "classification"
    | "confidentialReaderSubjects"
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
  schemaVersion: 2;
  sourceDigest: string;
  model: string;
  dimensions: number;
  records: readonly CorpusArtifactRecord[];
}>;

export type SearchCandidate = Readonly<{
  chunkId: string;
  documentId: string;
  corpusId: string;
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
