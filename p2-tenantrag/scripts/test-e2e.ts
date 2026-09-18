import { z } from "zod";
import { loadConfig } from "../src/config/project-config.js";
import { authorizePersona } from "../src/auth/cli.js";
import { loadProjectEnvironment } from "../src/config/environment.js";

loadProjectEnvironment();
const config = loadConfig();
const token = await authorizePersona("mallory", config);

const retrievalResponse = z.object({
  requestId: z.string().min(1),
  answer: z.string().nullable(),
  citations: z.array(
    z.object({
      documentId: z.string().min(1),
      chunkId: z.string().min(1),
      label: z.string().min(1),
    }),
  ),
});

async function retrieve(query: string) {
  const response = await fetch(`${config.baseUrl}/v1/retrievals`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      corpusId: "tenant-a-support",
      query,
    }),
    signal: AbortSignal.timeout(config.providerTimeoutMs * 2),
  });
  if (!response.ok) {
    throw new Error(
      `Permissive scenario failed with status ${response.status}`,
    );
  }
  return retrievalResponse.parse(await response.json());
}

const primary = await retrieve(
  "How should customer retrieval data be isolated?",
);
const primaryDocuments = new Set(
  primary.citations.map(({ documentId }) => documentId),
);
if (
  !primaryDocuments.has("a-public") ||
  !primaryDocuments.has("a-confidential")
) {
  throw new Error("Primary scenario did not retrieve both Tenant A documents");
}

const instructionLike = await retrieve(
  "What does the migration override note request?",
);
if (instructionLike.citations[0]?.documentId !== "a-instruction-like") {
  throw new Error(
    "Instruction-like scenario did not rank a-instruction-like first",
  );
}

console.log(JSON.stringify({ primary, instructionLike }, null, 2));
console.error(
  "Match both request IDs with the server's P2 server | FAKE ALLOW lines.",
);
