import { z } from "zod";
import { loadConfig } from "../src/config/project-config.js";
import { authorizePersona } from "../src/auth/cli.js";
import { loadProjectEnvironment } from "../src/config/environment.js";

loadProjectEnvironment();
const config = loadConfig();
const supportQuestion =
  "What customer steps and internal corrective actions followed Aster's 12 September support-search interruption?";
const adaToken = await authorizePersona("ada", config);

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

const errorResponse = z.object({
  error: z.string(),
  requestId: z.string().min(1),
});

async function retrieve(token: string, corpusId: string, query: string) {
  const response = await fetch(`${config.baseUrl}/v1/retrievals`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      corpusId,
      query,
    }),
    signal: AbortSignal.timeout(config.providerTimeoutMs * 2),
  });
  return response;
}

const primaryResponse = await retrieve(
  adaToken,
  "tenant-a-support",
  supportQuestion,
);
if (!primaryResponse.ok)
  throw new Error(`Ada retrieval failed with status ${primaryResponse.status}`);
const primary = retrievalResponse.parse(await primaryResponse.json());
const primaryDocuments = new Set(
  primary.citations.map(({ documentId }) => documentId),
);
if (
  !primaryDocuments.has("a-public") ||
  !primaryDocuments.has("a-confidential")
) {
  throw new Error("Primary scenario did not retrieve both Tenant A documents");
}

const instructionResponse = await retrieve(
  adaToken,
  "tenant-a-support",
  "What does the migration override note request?",
);
if (!instructionResponse.ok) {
  throw new Error(
    `Instruction-like retrieval failed with status ${instructionResponse.status}`,
  );
}
const instructionLike = retrievalResponse.parse(
  await instructionResponse.json(),
);
for (const response of [primary, instructionLike]) {
  if (
    response.citations.some(
      ({ documentId }) =>
        !["a-public", "a-confidential", "a-instruction-like"].includes(
          documentId,
        ),
    )
  )
    throw new Error("Ada received evidence outside Tenant A");
}
if (
  !instructionLike.citations.some(
    ({ documentId }) => documentId === "a-instruction-like",
  )
) {
  throw new Error(
    "Instruction-like scenario did not retrieve the imported migration notes",
  );
}

const leoToken = await authorizePersona("leo", config);
const leoResponse = await retrieve(
  leoToken,
  "tenant-a-support",
  supportQuestion,
);
if (!leoResponse.ok)
  throw new Error(`Leo retrieval failed with status ${leoResponse.status}`);
const leo = retrievalResponse.parse(await leoResponse.json());
if (
  !leo.citations.some(({ documentId }) => documentId === "a-public") ||
  leo.citations.some(
    ({ documentId }) =>
      !["a-public", "a-instruction-like"].includes(documentId),
  )
)
  throw new Error("Leo must receive only public Tenant A evidence");

const malloryToken = await authorizePersona("mallory", config);
const deniedResponse = await retrieve(
  malloryToken,
  "tenant-a-support",
  supportQuestion,
);
if (deniedResponse.status !== 404) {
  throw new Error(
    `Mallory cross-tenant retrieval returned ${deniedResponse.status}, expected 404`,
  );
}
const denied = errorResponse.parse(await deniedResponse.json());
if (denied.error !== "corpus_not_found") {
  throw new Error(`Mallory received unexpected error ${denied.error}`);
}

const unknownResponse = await retrieve(
  malloryToken,
  "unknown-corpus",
  supportQuestion,
);
const unknown = errorResponse.parse(await unknownResponse.json());
if (
  unknownResponse.status !== deniedResponse.status ||
  unknown.error !== denied.error
)
  throw new Error(
    "Unknown and forbidden corpora must return the same status and error code",
  );

console.log(
  JSON.stringify({ primary, instructionLike, leo, denied, unknown }, null, 2),
);
console.error(
  "Match the request IDs with the server's Cedarling and retrieval records.",
);
