import type { P2Config } from "../config/project-config.js";
import { createCorpusArtifact, writeCorpusArtifact } from "./corpus.js";
import { loadAllFixtures } from "./pdf.js";
import { createOpenRouterClient } from "./providers/openrouter.js";
import { createVoyageClient } from "./providers/voyage.js";
import type { FixtureDocument } from "./types.js";

async function buildCorpus(
  config: P2Config,
  documents: readonly FixtureDocument[],
): Promise<number> {
  const voyage = createVoyageClient({
    apiKey: config.voyageApiKey,
    model: config.voyageModel,
    dimensions: config.voyageDimensions,
    timeoutMs: config.providerTimeoutMs,
  });
  const artifact = await createCorpusArtifact(
    documents,
    voyage,
    config.voyageModel,
  );
  await writeCorpusArtifact(config.artifactPath, artifact);
  return artifact.records.length;
}

async function smokeOpenRouter(
  config: P2Config,
  documents: readonly FixtureDocument[],
): Promise<string> {
  const sample = documents.find(
    (document) => document.metadata.documentId === "a-public",
  )?.chunks[0];
  if (!sample) throw new Error("OpenRouter smoke fixture is unavailable");

  const openRouter = createOpenRouterClient({
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    timeoutMs: config.providerTimeoutMs,
  });
  const result = await openRouter.generate(
    "In one sentence, identify this as synthetic tutorial evidence.",
    [sample],
  );
  return result.model;
}

export async function resetCorpus(config: P2Config): Promise<number> {
  const documents = await loadAllFixtures(config.fixturesDirectory);
  return buildCorpus(config, documents);
}

/** Verifies the fixture set once, then prepares both live provider paths. */
export async function setupProject(
  config: P2Config,
): Promise<Readonly<{ recordCount: number; selectedModel: string }>> {
  const documents = await loadAllFixtures(config.fixturesDirectory);
  const recordCount = await buildCorpus(config, documents);
  const selectedModel = await smokeOpenRouter(config, documents);
  return { recordCount, selectedModel };
}
