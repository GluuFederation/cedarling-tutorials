import { create, insertMultiple, search } from "@orama/orama";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { VoyageClient } from "./providers/voyage.js";
import type {
  CorpusArtifact,
  FixtureDocument,
  SearchCandidate,
} from "./types.js";

const artifactSchema = z.object({
  schemaVersion: z.literal(1),
  model: z.string().min(1),
  dimensions: z.literal(256),
  records: z.array(
    z.object({
      chunkId: z.string().min(1),
      documentId: z.string().min(1),
      corpusId: z.string().min(1),
      embedding: z.array(z.number().finite()).length(256),
    }),
  ),
});

const oramaSchema = {
  chunkId: "string",
  documentId: "string",
  corpusId: "string",
  embedding: "vector[256]",
} as const;

type OramaDatabase = ReturnType<typeof create<typeof oramaSchema>>;

async function embeddingsInBatches(
  voyage: VoyageClient,
  texts: readonly string[],
): Promise<readonly (readonly number[])[]> {
  const embeddings: (readonly number[])[] = [];
  for (let offset = 0; offset < texts.length; offset += 256) {
    embeddings.push(
      ...(await voyage.embed(texts.slice(offset, offset + 256), "document")),
    );
  }
  return embeddings;
}

/**
 * Builds a vector-only artifact. Trusted metadata and protected chunk text stay
 * in FixtureRepository and are revalidated before retrieval.
 */
export async function createCorpusArtifact(
  documents: readonly FixtureDocument[],
  voyage: VoyageClient,
  model: string,
): Promise<CorpusArtifact> {
  const chunks = documents.flatMap((document) => document.chunks);
  const embeddings = await embeddingsInBatches(
    voyage,
    chunks.map((chunk) => chunk.text),
  );
  if (embeddings.length !== chunks.length) {
    throw new Error("Embedding count does not match fixture chunks");
  }
  const records = chunks.map((chunk, index) => ({
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    corpusId: chunk.corpusId,
    embedding: embeddings[index] ?? [],
  }));
  return { schemaVersion: 1, model, dimensions: 256, records };
}

/** Replaces the generated index atomically so startup never reads a partial file. */
export async function writeCorpusArtifact(
  artifactPath: string,
  artifact: CorpusArtifact,
): Promise<void> {
  artifactSchema.parse(artifact);
  await mkdir(dirname(artifactPath), { recursive: true });
  const temporaryPath = `${artifactPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    mode: 0o644,
  });
  await rename(temporaryPath, artifactPath);
}

export async function readCorpusArtifact(
  artifactPath: string,
): Promise<CorpusArtifact> {
  return artifactSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
}

/** Ensures the vector-only artifact still names the currently verified chunks. */
export function validateArtifactAgainstDocuments(
  artifact: CorpusArtifact,
  documents: readonly FixtureDocument[],
): void {
  const expected = new Map(
    documents.flatMap((document) =>
      document.chunks.map((chunk) => [chunk.chunkId, chunk] as const),
    ),
  );
  if (artifact.records.length !== expected.size) {
    throw new Error("Corpus artifact record count does not match the fixtures");
  }
  const seen = new Set<string>();
  for (const record of artifact.records) {
    const chunk = expected.get(record.chunkId);
    if (
      !chunk ||
      seen.has(record.chunkId) ||
      chunk.documentId !== record.documentId ||
      chunk.corpusId !== record.corpusId
    ) {
      throw new Error(
        "Corpus artifact relationships do not match the fixtures",
      );
    }
    seen.add(record.chunkId);
  }
}
export type CorpusSearch = Readonly<{
  search: (
    corpusId: string,
    queryEmbedding: readonly number[],
    limit: number,
  ) => Promise<readonly SearchCandidate[]>;
}>;

/** Builds a local index whose results stay corpus-scoped and omit vectors. */
export async function createCorpusSearch(
  artifact: CorpusArtifact,
): Promise<CorpusSearch> {
  artifactSchema.parse(artifact);
  const database: OramaDatabase = create({ schema: oramaSchema });
  await insertMultiple(
    database,
    artifact.records.map((record) => ({
      chunkId: record.chunkId,
      documentId: record.documentId,
      corpusId: record.corpusId,
      embedding: [...record.embedding],
    })),
  );
  return {
    async search(corpusId, queryEmbedding, limit) {
      if (queryEmbedding.length !== artifact.dimensions) {
        throw new Error("Query embedding dimensions do not match the corpus");
      }
      const results = await search(database, {
        mode: "vector",
        vector: { property: "embedding", value: [...queryEmbedding] },
        where: { corpusId },
        similarity: 0,
        limit,
        includeVectors: false,
      });
      return results.hits.map(({ document, score }) => ({
        chunkId: document.chunkId,
        documentId: document.documentId,
        corpusId: document.corpusId,
        score,
      }));
    },
  };
}
