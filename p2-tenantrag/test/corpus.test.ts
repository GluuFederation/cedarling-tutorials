import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCorpusArtifact,
  createCorpusSearch,
  readCorpusArtifact,
  validateArtifactAgainstDocuments,
  writeCorpusArtifact,
} from "../src/rag/corpus.js";
import type { VoyageClient } from "../src/rag/providers/voyage.js";
import type { CorpusArtifact, FixtureDocument } from "../src/rag/types.js";

function vector(index: number): number[] {
  return Array.from({ length: 256 }, (_, position) =>
    position === index ? 1 : 0,
  );
}

const documents: readonly FixtureDocument[] = [
  {
    metadata: {
      documentId: "a-public",
      title: "A public",
      corpusId: "tenant-a-support",
      tenantId: "tenant-a",
      classification: "public",
    },
    chunks: [
      {
        chunkId: "a-public-1",
        documentId: "a-public",
        corpusId: "tenant-a-support",
        text: "A evidence",
      },
    ],
  },
  {
    metadata: {
      documentId: "b-public",
      title: "B public",
      corpusId: "tenant-b-support",
      tenantId: "tenant-b",
      classification: "public",
    },
    chunks: [
      {
        chunkId: "b-public-1",
        documentId: "b-public",
        corpusId: "tenant-b-support",
        text: "B evidence",
      },
    ],
  },
];

describe("P2 corpus artifact and Orama search", () => {
  it("builds and atomically writes a vector-only artifact", async () => {
    const voyage: VoyageClient = {
      embed: async () => [vector(0), vector(1)],
    };
    const artifact = await createCorpusArtifact(
      documents,
      voyage,
      "voyage-4-lite",
    );
    const directory = await mkdtemp(join(tmpdir(), "cedarling-p2-corpus-"));
    const path = join(directory, "orama-index.json");
    await writeCorpusArtifact(path, artifact);
    await expect(readCorpusArtifact(path)).resolves.toEqual(artifact);
    expect(await readFile(path, "utf8")).not.toContain("A evidence");
    const replacement = {
      ...artifact,
      records: artifact.records.map((record) => ({
        ...record,
        embedding: vector(2),
      })),
    };
    await writeCorpusArtifact(path, replacement);
    await expect(readCorpusArtifact(path)).resolves.toEqual(replacement);
    await expect(access(`${path}.tmp`)).rejects.toThrow();
  });

  it("filters candidates to the resolved corpus and omits vectors", async () => {
    const artifact: CorpusArtifact = {
      schemaVersion: 1,
      model: "voyage-4-lite",
      dimensions: 256,
      records: [
        {
          chunkId: "a-public-1",
          documentId: "a-public",
          corpusId: "tenant-a-support",
          embedding: vector(0),
        },
        {
          chunkId: "b-public-1",
          documentId: "b-public",
          corpusId: "tenant-b-support",
          embedding: vector(0),
        },
      ],
    };
    const search = await createCorpusSearch(artifact);
    await expect(
      search.search("tenant-a-support", vector(0), 12),
    ).resolves.toEqual([
      {
        chunkId: "a-public-1",
        documentId: "a-public",
        corpusId: "tenant-a-support",
        score: 1,
      },
    ]);
  });

  it("rejects query vectors with the wrong dimension", async () => {
    const search = await createCorpusSearch({
      schemaVersion: 1,
      model: "voyage-4-lite",
      dimensions: 256,
      records: [],
    });
    await expect(search.search("tenant-a-support", [1], 1)).rejects.toThrow(
      "dimensions",
    );
  });

  it("rejects artifact relationships that drift from the fixtures", async () => {
    const voyage: VoyageClient = {
      embed: async () => [vector(0), vector(1)],
    };
    const artifact = await createCorpusArtifact(
      documents,
      voyage,
      "voyage-4-lite",
    );
    expect(() =>
      validateArtifactAgainstDocuments(artifact, documents),
    ).not.toThrow();
    expect(() =>
      validateArtifactAgainstDocuments(
        {
          ...artifact,
          records: [
            { ...artifact.records[0]!, documentId: "substituted" },
            ...artifact.records.slice(1),
          ],
        },
        documents,
      ),
    ).toThrow("relationships");
  });
});
