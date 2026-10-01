/** Loads P4 policies and calls Cedarling directly at the editorial service boundaries. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initFromArchiveBytes } from "@janssenproject/cedarling_wasm";
import { unzipSync } from "fflate";
import { unavailable } from "./errors.ts";
import type { Approval, ArticleView, Principal } from "./models.ts";

const actions = {
  "article.create": "CreateArticle",
  "article.read": "ReadArticle",
  "revision.edit": "EditRevision",
  "revision.submit": "SubmitRevision",
  "revision.approve": "ApproveRevision",
  "revision.reject": "RejectRevision",
  "publication.publish": "PublishRevision",
} as const;
type Capability = keyof typeof actions;
export const capabilities = Object.keys(actions) as Capability[];

export type AuthorizationRequest = {
  requestId: string;
  phase?: "preview" | "enforcement";
  principal: Pick<Principal, "id" | "tenantId">;
} & (
  | { capability: "article.create"; tenantId: string }
  | {
      capability: "article.read";
      article: Pick<ArticleView, "id" | "tenantId">;
    }
  | { capability: "revision.edit" | "revision.submit"; article: ArticleView }
  | {
      capability: "revision.approve" | "revision.reject";
      article: ArticleView;
      editorAuthorityCurrent: boolean;
    }
  | {
      capability: "publication.publish";
      article: ArticleView;
      publisherAuthorityCurrent: boolean;
      approval: Approval | undefined;
    }
);
export type AuthorizeEditorial = (
  request: AuthorizationRequest,
) => Promise<boolean>;

export async function createEditorialAuthorization(
  archivePath = resolve(".local/policy-store.cjar"),
) {
  const archive = new Uint8Array(await readFile(archivePath));
  const entry = unzipSync(archive)["metadata.json"];
  if (!entry) throw new Error("P4 policy archive has no metadata");
  const metadata = JSON.parse(new TextDecoder().decode(entry)) as {
    policy_store?: { version?: unknown };
  };
  if (typeof metadata.policy_store?.version !== "string")
    throw new Error("P4 policy archive has invalid metadata");
  console.info(
    `P4 Cedarling policy ${metadata.policy_store.version} | sha256 ${createHash("sha256").update(archive).digest("hex")}`,
  );
  const cedarling = await initFromArchiveBytes(
    {
      CEDARLING_APPLICATION_NAME: "P4 Editorial Publishing",
      CEDARLING_LOG_TYPE: "memory",
      CEDARLING_LOG_TTL: 300,
      CEDARLING_STRICT_SCHEMA_VALIDATION: "enabled",
    },
    archive,
  );

  const authorize: AuthorizeEditorial = async (request) => {
    const { principal, capability, requestId } = request;
    const resource =
      request.capability === "article.create"
        ? {
            cedar_entity_mapping: {
              entity_type: "P4EditorialPublishing::Tenant",
              id: request.tenantId,
            },
            id: request.tenantId,
          }
        : request.capability === "article.read"
          ? {
              cedar_entity_mapping: {
                entity_type: "P4EditorialPublishing::Article",
                id: request.article.id,
              },
              tenant_id: request.article.tenantId,
            }
          : {
              cedar_entity_mapping: {
                entity_type: "P4EditorialPublishing::Revision",
                id: request.article.revision.id,
              },
              revision_id: request.article.revision.id,
              tenant_id: request.article.tenantId,
              author_id: request.article.revision.authorId,
              version: request.article.revision.version,
              digest: request.article.revision.digest,
              state: request.article.revision.state,
            };
    const context =
      "editorAuthorityCurrent" in request
        ? { editor_authority_current: request.editorAuthorityCurrent }
        : request.capability === "publication.publish"
          ? {
              publisher_authority_current: request.publisherAuthorityCurrent,
              ...(request.approval
                ? {
                    approval: {
                      revision_id: request.approval.revisionId,
                      revision_version: request.approval.revisionVersion,
                      digest: request.approval.digest,
                      reviewer_id: request.approval.reviewerId,
                      reviewer_authority_current:
                        request.approval.authorityCurrent,
                    },
                  }
                : {}),
            }
          : {};
    try {
      const result = await cedarling.authorizeUnsigned(
        JSON.stringify({
          principal: {
            cedar_entity_mapping: {
              entity_type: "P4EditorialPublishing::Principal",
              id: principal.id,
            },
            id: principal.id,
            tenant_id: principal.tenantId,
          },
          action: `P4EditorialPublishing::Action::"${actions[capability]}"`,
          resource,
          context,
        }),
      );
      console.info(
        JSON.stringify(
          {
            event: "authorization.context",
            requestId,
            actorId: principal.id,
            capability,
            phase: request.phase ?? "enforcement",
            resource: resource.cedar_entity_mapping,
            cedarlingRequestId: result.request_id,
          },
          null,
          2,
        ),
      );
      for (const log of cedarling.getLogsByRequestId(result.request_id)) {
        console.info(JSON.stringify(log, null, 2));
      }
      if (result.response.diagnostics.errors.length > 0) throw unavailable();
      return result.decision === true;
    } catch {
      // SDK exception messages may contain request data; keep failures bounded.
      console.warn(
        JSON.stringify(
          {
            event: "authorization.failed",
            requestId,
            actorId: principal.id,
            capability,
            phase: request.phase ?? "enforcement",
            category: "authorization_unavailable",
          },
          null,
          2,
        ),
      );
      throw unavailable();
    }
  };
  return { authorize, close: () => cedarling.shutDown() };
}
