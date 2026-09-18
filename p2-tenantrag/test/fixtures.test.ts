import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fixtureDefinitions } from "../src/rag/fixtures.js";
import {
  loadAllFixtures,
  loadFixtureDocument,
  maximumChunkCharacters,
  reconstructParagraphs,
  splitIntoChunks,
  validateDefinitions,
} from "../src/rag/pdf.js";

describe("P2 PDF fixtures", () => {
  it("verifies all PDFs and their frozen page and chunk contracts", async () => {
    const documents = await loadAllFixtures("./fixtures");
    expect(
      documents.map((document) => [
        document.metadata.documentId,
        document.chunks.length,
      ]),
    ).toEqual([
      ["a-public", 20],
      ["a-confidential", 37],
      ["b-public", 18],
      ["b-confidential", 30],
      ["a-instruction-like", 48],
    ]);
    for (const document of documents) {
      expect(document.chunks.every((chunk) => chunk.text.length > 0)).toBe(
        true,
      );
      expect(
        document.chunks.every(
          (chunk) => chunk.text.length <= maximumChunkCharacters,
        ),
      ).toBe(true);
      expect(document.chunks[0]?.chunkId).toBe(
        `${document.metadata.documentId}-1`,
      );
    }
  });

  it("keeps only the five registered PDFs in the fixture directory", async () => {
    const files = (await readdir("./fixtures")).sort();
    expect(files).toEqual(
      fixtureDefinitions.map(({ pdfFileName }) => pdfFileName).sort(),
    );
    expect(files.every((file) => file.endsWith(".pdf"))).toBe(true);
  });

  it("reconstructs wrapped lines while preserving visual paragraph gaps", () => {
    const text = reconstructParagraphs([
      {
        str: "First wrapped",
        hasEOL: true,
        height: 10,
        transform: [0, 0, 0, 0, 0, 100],
      },
      {
        str: "line.",
        hasEOL: false,
        height: 10,
        transform: [0, 0, 0, 0, 0, 86],
      },
      {
        str: "Next paragraph.",
        hasEOL: false,
        height: 10,
        transform: [0, 0, 0, 0, 0, 60],
      },
    ]);
    expect(text).toBe("First wrapped line.\nNext paragraph.");
  });

  it("splits oversized input deterministically", () => {
    const value = Array.from(
      { length: 120 },
      (_, index) => `word${index}`,
    ).join(" ");
    const first = splitIntoChunks(value);
    expect(splitIntoChunks(value)).toEqual(first);
    expect(first.every((chunk) => chunk.length <= maximumChunkCharacters)).toBe(
      true,
    );
  });

  it("rejects incomplete and duplicate fixture registries", () => {
    expect(() => validateDefinitions(fixtureDefinitions.slice(0, 4))).toThrow(
      "exactly five",
    );
    const duplicate = [
      ...fixtureDefinitions.slice(0, 4),
      { ...fixtureDefinitions[0]! },
    ];
    expect(() => validateDefinitions(duplicate)).toThrow(
      "Duplicate fixture document ID",
    );
  });

  it("rejects fixture digest, page, and frozen chunk-count drift", async () => {
    const fixture = fixtureDefinitions[0]!;
    await expect(
      loadFixtureDocument("./fixtures", {
        ...fixture,
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("digest");
    await expect(
      loadFixtureDocument("./fixtures", {
        ...fixture,
        expectedPageCount: fixture.expectedPageCount + 1,
      }),
    ).rejects.toThrow("expected 3 pages");
    await expect(
      loadFixtureDocument("./fixtures", {
        ...fixture,
        expectedChunkCount: fixture.expectedChunkCount + 1,
      }),
    ).rejects.toThrow("expected 21 chunks");
  });
});
