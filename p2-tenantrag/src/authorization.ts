import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { initFromArchiveBytes } from "@janssenproject/cedarling_wasm";
import { unzipSync } from "fflate";
import type { AuthenticatedPrincipal } from "./auth/authenticator.js";
import type { Corpus } from "./rag/repository.js";
import type { AccessProfile, DocumentMetadata } from "./rag/types.js";

export type RetrievalAuthorization = Readonly<{
  authorizeCorpus(
    requestId: string,
    principal: AuthenticatedPrincipal,
    profile: AccessProfile,
    corpus: Corpus,
  ): Promise<boolean>;
  authorizeDocuments(
    requestId: string,
    principal: AuthenticatedPrincipal,
    profile: AccessProfile,
    corpus: Corpus,
    documents: readonly DocumentMetadata[],
  ): Promise<boolean[]>;
  close(): Promise<void>;
}>;

function policyVersion(archive: Uint8Array): string {
  const entry = unzipSync(archive)["metadata.json"];
  if (entry === undefined)
    throw new Error("P2 policy archive is missing metadata.json");
  const metadata = JSON.parse(new TextDecoder().decode(entry)) as {
    policy_store?: { version?: unknown };
  };
  if (typeof metadata.policy_store?.version !== "string")
    throw new Error("P2 policy archive metadata is invalid");
  return metadata.policy_store.version;
}

function requestContext(
  principal: AuthenticatedPrincipal,
  profile: AccessProfile,
  corpus: Corpus,
): object {
  return {
    boundary: "server",
    user: { subject: principal.id, tenant_id: profile.tenantId },
    selected_corpus_id: corpus.corpusId,
  };
}

function tokenSet(principal: AuthenticatedPrincipal): object[] {
  return [
    {
      mapping: "P2TenantRAG::Access_token",
      payload: principal.accessToken,
    },
  ];
}

export async function createRetrievalAuthorization(
  policyStorePath: string,
): Promise<RetrievalAuthorization> {
  const archive = new Uint8Array(await readFile(policyStorePath));
  const policy = {
    version: policyVersion(archive),
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
  console.info(
    `P2 Cedarling policy ${policy.version} | sha256 ${policy.sha256}`,
  );
  const cedarling = await initFromArchiveBytes(
    {
      CEDARLING_APPLICATION_NAME: "P2 TenantRAG server",
      CEDARLING_LOG_TYPE: "memory",
      CEDARLING_LOG_TTL: 300,
      CEDARLING_JWT_SIG_VALIDATION: "enabled",
      CEDARLING_JWT_SIGNATURE_ALGORITHMS_SUPPORTED: ["RS256"],
      CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
      CEDARLING_TRUSTED_ISSUER_LOADER_TYPE: "SYNC",
    },
    archive,
  );
  if (cedarling.loadedTrustedIssuersCount() < 1) {
    await cedarling.shutDown();
    throw new Error("P2 requires at least one trusted issuer");
  }

  return {
    async authorizeCorpus(requestId, principal, profile, corpus) {
      const result = await cedarling.authorizeMultiIssuer(
        JSON.stringify({
          tokens: tokenSet(principal),
          action: 'RAG::Action::"SearchCorpus"',
          resource: {
            cedar_entity_mapping: {
              entity_type: "RAG::Corpus",
              id: corpus.corpusId,
            },
            corpus_id: corpus.corpusId,
            tenant_id: corpus.tenantId,
          },
          context: requestContext(principal, profile, corpus),
        }),
      );
      console.info(
        JSON.stringify(
          {
            event: "authorization.context",
            requestId,
            actorId: principal.id,
            stage: "corpus.search",
            cedarlingRequestId: result.request_id,
          },
          null,
          2,
        ),
      );
      for (const log of cedarling.getLogsByRequestId(result.request_id)) {
        console.info(JSON.stringify(log, null, 2));
      }
      if (result.response.diagnostics.errors.length > 0)
        throw new Error("Cedarling returned policy evaluation errors");
      return result.decision;
    },
    async authorizeDocuments(requestId, principal, profile, corpus, documents) {
      if (documents.length === 0) return [];
      const batch = await cedarling.authorizeMultiIssuerBatch(
        JSON.stringify({
          tokens: tokenSet(principal),
          items: documents.map((document) => ({
            action: 'RAG::Action::"RetrieveDocument"',
            resource: {
              cedar_entity_mapping: {
                entity_type: "RAG::Document",
                id: document.documentId,
              },
              corpus_id: document.corpusId,
              tenant_id: document.tenantId,
              classification: document.classification,
              confidential_reader_subjects: document.confidentialReaderSubjects,
            },
            context: requestContext(principal, profile, corpus),
          })),
        }),
      );
      const decisions: boolean[] = [];
      for (const item of batch.results) {
        if (!item.is_ok) {
          throw new Error(
            `Cedarling document batch failed: ${item.error?.category ?? "unknown"}`,
          );
        }
        const result = item.unwrap();
        console.info(
          JSON.stringify(
            {
              event: "authorization.context",
              requestId,
              actorId: principal.id,
              stage: "document.retrieve",
              cedarlingRequestId: result.request_id,
            },
            null,
            2,
          ),
        );
        for (const log of cedarling.getLogsByRequestId(result.request_id)) {
          console.info(JSON.stringify(log, null, 2));
        }
        if (result.response.diagnostics.errors.length > 0)
          throw new Error("Cedarling returned policy evaluation errors");
        decisions.push(result.decision);
      }
      return decisions;
    },
    async close() {
      await cedarling.shutDown();
    },
  };
}
