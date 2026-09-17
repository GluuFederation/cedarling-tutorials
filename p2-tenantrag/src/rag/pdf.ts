import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fixtureDefinitions } from "./fixtures.js";
import type {
  FixtureDefinition,
  FixtureDocument,
  FixtureChunk,
} from "./types.js";

export const maximumChunkCharacters = 400;

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim();
}

export function splitIntoChunks(value: string): readonly string[] {
  const normalized = normalizeExtractedText(value);
  if (!normalized) return [];

  const chunks: string[] = [];
  for (const paragraph of normalized.split(/\n+/).map((part) => part.trim())) {
    if (!paragraph) continue;
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      if (word.length > maximumChunkCharacters) {
        if (current) chunks.push(current);
        for (
          let offset = 0;
          offset < word.length;
          offset += maximumChunkCharacters
        ) {
          chunks.push(word.slice(offset, offset + maximumChunkCharacters));
        }
        current = "";
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maximumChunkCharacters) {
        current = candidate;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

type PositionedText = Readonly<{
  str: string;
  hasEOL: boolean;
  height: number;
  transform: ArrayLike<number>;
}>;

/**
 * Reassembles PDF.js text fragments into stable paragraphs. Items on one
 * baseline form a line; font changes and larger vertical gaps start a
 * paragraph so wrapped prose stays together without merging headings.
 */
export function reconstructParagraphs(
  items: readonly PositionedText[],
): string {
  const lines: Array<{ text: string; y: number; height: number }> = [];
  let current: { text: string; y: number; height: number } | undefined;
  for (const item of items) {
    const y = Number(item.transform[5]);
    if (!Number.isFinite(y)) continue;
    if (!current || Math.abs(current.y - y) > 0.5) {
      if (current?.text.trim()) lines.push(current);
      current = { text: item.str, y, height: item.height };
    } else {
      current.text += item.str;
      current.height = Math.max(current.height, item.height);
    }
    if (item.hasEOL && current.text.trim()) {
      lines.push(current);
      current = undefined;
    }
  }
  if (current?.text.trim()) lines.push(current);

  const paragraphs: string[] = [];
  for (const [index, line] of lines.entries()) {
    const text = normalizeExtractedText(line.text);
    if (!text) continue;
    const previous = lines[index - 1];
    const verticalGap = previous ? Math.abs(previous.y - line.y) : Infinity;
    const referenceHeight = Math.max(previous?.height ?? 0, line.height, 1);
    const changesTextSize = previous
      ? Math.abs(previous.height - line.height) > 1.5
      : true;
    if (
      paragraphs.length === 0 ||
      changesTextSize ||
      verticalGap > referenceHeight * 1.55
    ) {
      paragraphs.push(text);
    } else {
      const previousParagraph = paragraphs.at(-1);
      paragraphs[paragraphs.length - 1] = previousParagraph
        ? `${previousParagraph} ${text}`
        : text;
    }
  }
  return paragraphs.join("\n");
}

/**
 * Verifies the exact reviewed PDF bytes before parsing; page and chunk counts
 * then lock the deterministic extraction result used to build embeddings.
 */
export async function loadFixtureDocument(
  fixturesDirectory: string,
  definition: FixtureDefinition,
  enforceExpectedChunkCount = true,
): Promise<FixtureDocument> {
  const pdfPath = resolve(fixturesDirectory, definition.pdfFileName);
  const bytes = await readFile(pdfPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== definition.sha256) {
    throw new Error(`${definition.documentId} PDF digest does not match`);
  }

  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  try {
    if (pdf.numPages !== definition.expectedPageCount) {
      throw new Error(
        `${definition.documentId} expected ${definition.expectedPageCount} pages, received ${pdf.numPages}`,
      );
    }

    const text: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (
          item,
        ): item is Extract<(typeof content.items)[number], { str: string }> =>
          "str" in item,
      );
      text.push(reconstructParagraphs(items));
    }

    const chunkTexts = text.flatMap((page) => splitIntoChunks(page));
    if (chunkTexts.length === 0) {
      throw new Error(`${definition.documentId} produced no text chunks`);
    }
    if (
      enforceExpectedChunkCount &&
      chunkTexts.length !== definition.expectedChunkCount
    ) {
      throw new Error(
        `${definition.documentId} expected ${definition.expectedChunkCount} chunks, received ${chunkTexts.length}`,
      );
    }

    const chunks: FixtureChunk[] = chunkTexts.map((chunkText, index) => ({
      chunkId: `${definition.documentId}-${index + 1}`,
      documentId: definition.documentId,
      corpusId: definition.corpusId,
      text: chunkText,
    }));

    return {
      metadata: {
        documentId: definition.documentId,
        title: definition.title,
        corpusId: definition.corpusId,
        tenantId: definition.tenantId,
        classification: definition.classification,
      },
      chunks,
    };
  } finally {
    await task.destroy();
  }
}

export async function loadAllFixtures(
  fixturesDirectory: string,
  definitions: readonly FixtureDefinition[] = fixtureDefinitions,
  enforceExpectedChunkCount = true,
): Promise<readonly FixtureDocument[]> {
  validateDefinitions(definitions);
  return Promise.all(
    definitions.map((definition) =>
      loadFixtureDocument(
        fixturesDirectory,
        definition,
        enforceExpectedChunkCount,
      ),
    ),
  );
}

export function validateDefinitions(
  definitions: readonly FixtureDefinition[],
): void {
  if (definitions.length !== 5) {
    throw new Error("P2 requires exactly five fixture definitions");
  }
  const documentIds = new Set<string>();
  const fileNames = new Set<string>();
  for (const definition of definitions) {
    if (documentIds.has(definition.documentId)) {
      throw new Error(
        `Duplicate fixture document ID: ${definition.documentId}`,
      );
    }
    if (fileNames.has(definition.pdfFileName)) {
      throw new Error(
        `Duplicate fixture PDF filename: ${definition.pdfFileName}`,
      );
    }
    documentIds.add(definition.documentId);
    fileNames.add(definition.pdfFileName);
  }
}
