import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  approveRevision,
  publishRevision,
  rejectRevision,
  saveDraft,
  submitRevision,
} from "@/app/actions.ts";
import { CreateArticleLink } from "@/app/components.tsx";
import { isAppError } from "@/src/server/errors.ts";
import type { ArticleView } from "@/src/server/models.ts";
import { runtime } from "@/src/server/runtime.ts";
import { Check } from "@/src/web/icons.tsx";

const outcomes: Record<string, string> = {
  "article-created": "Article created.",
  "draft-saved": "Draft saved.",
  "submit-complete": "Revision submitted for review.",
  "approve-complete": "Exact revision approved.",
  "reject-complete": "Exact revision rejected.",
  "publish-complete": "Current revision published.",
  "error-state_conflict": "The article changed. Refresh and try again.",
  "error-forbidden": "This action is not allowed.",
  "error-request_integrity_failed":
    "The request could not be verified. Refresh and try again.",
  "error-invalid_request": "Check the submitted values and try again.",
  "error-service_unavailable": "A required service is unavailable.",
};

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<{
    revision?: string;
    outcome?: string;
  }>;
}) {
  const services = await runtime();
  const session = await services.sessions.optional();
  if (!session) redirect("/?expired=1");
  const { articleId } = await params;
  const query = await searchParams;
  const requestId =
    (await headers()).get("x-request-id") ?? crypto.randomUUID();
  let article: ArticleView;
  try {
    article = await services.editorial.read(
      session,
      articleId,
      query.revision,
      requestId,
    );
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }
  const articles = await services.editorial.list(session, requestId);
  const canCreate = await services.editorial.canCreate(session, requestId);
  const isCurrent = article.revision.id === article.currentRevisionId;
  const allowed = await services.editorial.availability(
    session,
    article,
    requestId,
  );
  const editable = allowed.edit;
  const mutationFields = (
    <>
      <input type="hidden" name="_csrf" value={session.csrfToken} />
      <input type="hidden" name="articleId" value={article.id} />
      <input type="hidden" name="revisionId" value={article.revision.id} />
      <input type="hidden" name="expectedVersion" value={article.version} />
    </>
  );
  const outcome = query.outcome ? outcomes[query.outcome] : undefined;
  return (
    <main className="workspace">
      <aside className="article-queue" aria-label="Editorial queue">
        <div className="section-heading">
          <p className="eyebrow">Editorial queue</p>
          <h2>Articles</h2>
          <CreateArticleLink allowed={canCreate} />
        </div>
        <nav className="article-list">
          {articles.map((item) => (
            <Link
              className={
                item.id === article.id
                  ? "article-item selected"
                  : "article-item"
              }
              href={`/articles/${item.id}`}
              key={item.id}
            >
              <strong>{item.title}</strong>
              <span>
                Revision {item.version} · {item.state}
              </span>
            </Link>
          ))}
        </nav>
      </aside>

      <section className="editorial-panel" aria-labelledby="article-title">
        <div className="editorial-content">
          <header className="article-heading">
            <div>
              <p className="eyebrow">Revision {article.revision.version}</p>
              <h2 id="article-title">{article.revision.title}</h2>
            </div>
            <span className={`status status-${article.revision.state}`}>
              {article.revision.state}
            </span>
          </header>

          {outcome ? (
            <p
              className={
                query.outcome?.startsWith("error-")
                  ? "outcome error"
                  : "outcome success"
              }
              role="status"
            >
              {outcome}
            </p>
          ) : null}

          <form action={saveDraft} className="editor-form">
            {mutationFields}
            <label>
              Title
              <input
                name="title"
                defaultValue={article.revision.title}
                maxLength={160}
                required
                disabled={!editable}
              />
            </label>
            <label>
              Body
              <textarea
                name="body"
                defaultValue={article.revision.body}
                rows={9}
                required
                disabled={!editable}
              />
            </label>
            {isCurrent ? (
              <div className="action-row">
                <button
                  className="secondary"
                  type="submit"
                  disabled={!editable}
                  aria-describedby={!editable ? "edit-denied" : undefined}
                >
                  {article.revision.state === "draft"
                    ? "Save draft"
                    : "Create new draft"}
                </button>
                {!editable && (
                  <p className="permission-note" id="edit-denied">
                    You cannot edit this article.
                  </p>
                )}
              </div>
            ) : null}
          </form>

          {isCurrent ? (
            <div className="action-row primary-actions">
              {article.revision.state === "draft" ? (
                <form action={submitRevision}>
                  {mutationFields}
                  <button
                    className="primary"
                    type="submit"
                    disabled={!allowed.submit}
                    aria-describedby={
                      !allowed.submit ? "submit-denied" : undefined
                    }
                  >
                    <Check />
                    Submit for review
                  </button>
                  {!allowed.submit && (
                    <p className="permission-note" id="submit-denied">
                      You cannot submit this revision.
                    </p>
                  )}
                </form>
              ) : null}
              {article.revision.state === "submitted" ? (
                <>
                  <form action={approveRevision}>
                    {mutationFields}
                    <button
                      className="primary"
                      type="submit"
                      disabled={!allowed.approve}
                      aria-describedby={
                        !allowed.approve ? "approve-denied" : undefined
                      }
                    >
                      <Check />
                      Approve revision
                    </button>
                    {!allowed.approve && (
                      <p className="permission-note" id="approve-denied">
                        You cannot approve this revision.
                      </p>
                    )}
                  </form>
                  <form action={rejectRevision}>
                    {mutationFields}
                    <button
                      className="secondary"
                      type="submit"
                      disabled={!allowed.reject}
                      aria-describedby={
                        !allowed.reject ? "reject-denied" : undefined
                      }
                    >
                      Reject revision
                    </button>
                    {!allowed.reject && (
                      <p className="permission-note" id="reject-denied">
                        You cannot reject this revision.
                      </p>
                    )}
                  </form>
                </>
              ) : null}
              {["submitted", "approved"].includes(article.revision.state) ? (
                <form action={publishRevision}>
                  {mutationFields}
                  <button
                    className="primary"
                    type="submit"
                    disabled={!allowed.publish}
                    aria-describedby={
                      !allowed.publish ? "publish-denied" : undefined
                    }
                  >
                    Publish current revision
                  </button>
                  {!allowed.publish && (
                    <p className="permission-note" id="publish-denied">
                      You cannot publish this revision.
                    </p>
                  )}
                </form>
              ) : null}
            </div>
          ) : null}

          <section className="evidence" aria-labelledby="evidence-title">
            <div className="section-heading compact">
              <p className="eyebrow">Trusted record</p>
              <h3 id="evidence-title">Revision evidence</h3>
            </div>
            <dl className="evidence-grid">
              <div>
                <dt>Author</dt>
                <dd>{article.revision.authorName}</dd>
              </div>
              <div>
                <dt>Digest</dt>
                <dd>
                  <code>{article.revision.digest.slice(0, 12)}</code>
                </dd>
              </div>
              <div>
                <dt>Article version</dt>
                <dd>{article.version}</dd>
              </div>
              <div>
                <dt>Publication</dt>
                <dd>{article.published ? "Published" : "Not published"}</dd>
              </div>
              <div>
                <dt>Review</dt>
                <dd>
                  {article.review
                    ? `${article.review.decision} by ${article.review.reviewerName}`
                    : "No decision"}
                </dd>
              </div>
              <div>
                <dt>Reviewer authority</dt>
                <dd>
                  {article.review
                    ? article.review.authorityCurrent
                      ? "Current"
                      : "Revoked"
                    : "Not applicable"}
                </dd>
              </div>
            </dl>
            <nav className="revision-list" aria-label="Article revisions">
              {article.revisions.map((revision) => (
                <Link
                  className={
                    revision.id === article.revision.id ? "selected" : ""
                  }
                  href={`/articles/${article.id}?revision=${revision.id}`}
                  key={revision.id}
                >
                  Revision {revision.version} · {revision.state}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      </section>
    </main>
  );
}
