import { lstat } from "node:fs/promises";
import { loadConfig } from "../src/config/project-config.js";
import { resetCorpus } from "../src/rag/setup.js";

const config = loadConfig();
try {
  const file = await lstat(config.artifactPath);
  if (!file.isFile() || file.nlink !== 1)
    throw new Error("Corpus index must be an unlinked regular file");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  )
    throw error;
  console.info(
    "P2 preparing the corpus once using Voyage; subsequent starts reuse it.",
  );
  await resetCorpus(config);
}
// Runtime validates the persisted artifact against the fixtures before listening.
await import("../src/main.js");
