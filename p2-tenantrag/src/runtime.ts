import { createAuthenticator } from "./auth/authenticator.js";
import {
  readCorpusArtifact,
  createCorpusSearch,
  validateArtifactAgainstDocuments,
} from "./rag/corpus.js";
import type { P2Config } from "./config/project-config.js";
import { loadAllFixtures } from "./rag/pdf.js";
import { createOpenRouterClient } from "./rag/providers/openrouter.js";
import { createVoyageClient } from "./rag/providers/voyage.js";
import { FixtureRepository } from "./rag/repository.js";
import { createRetrievalService } from "./rag/retrieval.js";

/** Composes the verified local corpus, remote providers, auth, and HTTP services. */
export async function createRuntime(config: P2Config) {
  const documents = await loadAllFixtures(config.fixturesDirectory);
  const repository = new FixtureRepository(documents);
  const artifact = await readCorpusArtifact(config.artifactPath);
  if (artifact.model !== config.voyageModel) {
    throw new Error("Corpus artifact model does not match P2 configuration");
  }
  validateArtifactAgainstDocuments(artifact, documents);
  const corpusSearch = await createCorpusSearch(artifact);
  const voyage = createVoyageClient({
    apiKey: config.voyageApiKey,
    model: config.voyageModel,
    dimensions: config.voyageDimensions,
    timeoutMs: config.providerTimeoutMs,
  });
  const openRouter = createOpenRouterClient({
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    timeoutMs: config.providerTimeoutMs,
  });
  return {
    authenticator: createAuthenticator({
      issuer: config.issuer,
      audience: config.apiResource,
    }),
    retrievalService: createRetrievalService({
      repository,
      corpusSearch,
      voyage,
      openRouter,
    }),
  };
}
