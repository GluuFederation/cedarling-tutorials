import { z } from "zod";
import type { AuthorizationGateway, Capability } from "./authorization.ts";
import type { AppDatabase } from "./database.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";
import type { ArticleSummary, ArticleView, Session } from "./models.ts";

const id = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/u);
const expectedVersion = z.coerce.number().int().positive();
const draft = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .transform((value) => value.normalize("NFC")),
  body: z.string().transform((value) => value.normalize("NFC")),
});
type RevisionCapability = Exclude<
  Capability,
  "article.create" | "article.read"
>;

export class EditorialService {
  private readonly database: AppDatabase;
  private readonly authorization: AuthorizationGateway;

  constructor(database: AppDatabase, authorization: AuthorizationGateway) {
    this.database = database;
    this.authorization = authorization;
  }

  async canCreate(session: Session, requestId: string): Promise<boolean> {
    return this.authorization.authorize({
      requestId,
      capability: "article.create",
      actor: session.principal.subject,
      resource: session.principal.tenantId,
      facts: { tenantMatch: true },
    });
  }

  /** UI guidance only; each mutation reloads facts and authorizes again. */
  async availability(
    session: Session,
    article: ArticleView,
    requestId: string,
  ) {
    const current = article.revision.id === article.currentRevisionId;
    const preview = (capability: RevisionCapability) =>
      this.decideAction(
        session,
        requestId,
        capability,
        article,
        article.version,
      );
    return {
      edit:
        current &&
        (article.revision.state === "draft" || article.revisions.length < 20) &&
        (await preview("revision.edit")),
      submit:
        current &&
        article.revision.state === "draft" &&
        (await preview("revision.submit")),
      approve:
        current &&
        article.revision.state === "submitted" &&
        (await preview("revision.approve")),
      reject:
        current &&
        article.revision.state === "submitted" &&
        (await preview("revision.reject")),
      publish:
        current &&
        ["submitted", "approved"].includes(article.revision.state) &&
        (await preview("publication.publish")),
    };
  }

  async create(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<string> {
    const content = draft.safeParse({
      title: form.get("title"),
      body: form.get("body"),
    });
    if (
      !content.success ||
      !content.data.body.trim() ||
      Buffer.byteLength(content.data.body, "utf8") > 32_768
    )
      throw badRequest("Title or body is outside the tutorial bounds");
    await this.allow(
      session,
      requestId,
      "article.create",
      session.principal.tenantId,
      { tenantMatch: true },
    );
    return this.database.createArticle({
      ...content.data,
      tenantId: session.principal.tenantId,
      authorId: session.principal.id,
    });
  }

  async list(session: Session, requestId: string): Promise<ArticleSummary[]> {
    const result: ArticleSummary[] = [];
    for (const article of this.database.listArticles(
      session.principal.tenantId,
    )) {
      if (
        await this.authorization.authorize({
          requestId,
          capability: "article.read",
          actor: session.principal.subject,
          resource: article.id,
          facts: { tenantMatch: true, revisionState: article.state },
        })
      ) {
        result.push(article);
      }
    }
    return result;
  }

  async read(
    session: Session,
    articleCandidate: string,
    revisionCandidate: string | undefined,
    requestId: string,
  ): Promise<ArticleView> {
    const articleId = this.parseId(articleCandidate);
    const revisionId = revisionCandidate
      ? this.parseId(revisionCandidate)
      : undefined;
    const article = this.database.article(
      articleId,
      session.principal.tenantId,
      revisionId,
    );
    if (!article) throw notFound();
    if (
      !(await this.authorization.authorize({
        requestId,
        capability: "article.read",
        actor: session.principal.subject,
        resource: article.revision.id,
        facts: {
          tenantMatch: true,
          currentRevision: article.currentRevisionId === article.revision.id,
          revisionState: article.revision.state,
        },
      }))
    ) {
      throw notFound();
    }
    return article;
  }

  async saveDraft(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<string> {
    const articleId = this.parseId(form.get("articleId"));
    const version = this.parseVersion(form.get("expectedVersion"));
    const content = draft.safeParse({
      title: form.get("title"),
      body: form.get("body"),
    });
    if (
      !content.success ||
      Buffer.byteLength(content.data.body, "utf8") > 32_768
    )
      throw badRequest("Title or body is outside the tutorial bounds");
    const current = this.database.article(
      articleId,
      session.principal.tenantId,
    );
    if (!current) throw notFound();
    await this.allowAction(
      session,
      requestId,
      "revision.edit",
      current,
      version,
    );
    return this.database.saveDraft({
      articleId,
      tenantId: session.principal.tenantId,
      actorId: session.principal.id,
      expectedVersion: version,
      ...content.data,
    });
  }

  async submit(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<void> {
    const values = this.mutationCandidates(form);
    const current = this.current(session, values.articleId);
    await this.allowAction(
      session,
      requestId,
      "revision.submit",
      current,
      values.version,
      values.revisionId,
    );
    this.database.submit(
      values.articleId,
      session.principal.tenantId,
      values.revisionId,
      values.version,
    );
  }

  async review(
    session: Session,
    form: FormData,
    requestId: string,
    decision: "approved" | "rejected",
  ): Promise<void> {
    const values = this.mutationCandidates(form);
    const current = this.current(session, values.articleId);
    const capability: Capability =
      decision === "approved" ? "revision.approve" : "revision.reject";
    await this.allowAction(
      session,
      requestId,
      capability,
      current,
      values.version,
      values.revisionId,
    );
    this.database.review(
      values.articleId,
      session.principal.tenantId,
      values.revisionId,
      session.principal.id,
      values.version,
      decision,
    );
  }

  async publish(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<string> {
    const articleId = this.parseId(form.get("articleId"));
    const version = this.parseVersion(form.get("expectedVersion"));
    const current = this.current(session, articleId);
    await this.allowAction(
      session,
      requestId,
      "publication.publish",
      current,
      version,
    );
    return this.database.publish(
      articleId,
      session.principal.tenantId,
      session.principal.id,
      version,
    );
  }

  private current(session: Session, articleId: string): ArticleView {
    const article = this.database.article(
      articleId,
      session.principal.tenantId,
    );
    if (!article) throw notFound();
    return article;
  }

  private mutationCandidates(form: FormData) {
    return {
      articleId: this.parseId(form.get("articleId")),
      revisionId: this.parseId(form.get("revisionId")),
      version: this.parseVersion(form.get("expectedVersion")),
    };
  }

  private parseId(value: unknown): string {
    const parsed = id.safeParse(value);
    if (!parsed.success) throw badRequest();
    return parsed.data;
  }

  private parseVersion(value: unknown): number {
    const parsed = expectedVersion.safeParse(value);
    if (!parsed.success) throw badRequest();
    return parsed.data;
  }

  private decideAction(
    session: Session,
    requestId: string,
    capability: RevisionCapability,
    article: ArticleView,
    expectedVersion: number,
    resource = article.revision.id,
  ): Promise<boolean> {
    const facts: Record<string, boolean | number | string> = {
      revisionState: article.revision.state,
      expectedVersion,
    };
    if (capability === "revision.edit" || capability === "revision.submit") {
      facts.actorIsAuthor = article.revision.authorId === session.principal.id;
    } else if (
      capability === "revision.approve" ||
      capability === "revision.reject"
    ) {
      facts.selfReview = article.revision.authorId === session.principal.id;
      facts.editorAuthorityCurrent = this.database.hasCurrentAuthority(
        session.principal.id,
        article.tenantId,
        "editor",
      );
    } else {
      const approval = this.database.latestApproval(article.id);
      facts.publisherAuthorityCurrent = this.database.hasCurrentAuthority(
        session.principal.id,
        article.tenantId,
        "publisher",
      );
      facts.approvalPresent = Boolean(approval);
      facts.approvalMatchesRevision =
        approval?.revisionId === article.revision.id;
      facts.approvalMatchesDigest =
        approval?.digest === article.revision.digest;
      facts.reviewerAuthorityCurrent = approval?.authorityCurrent ?? false;
    }
    return this.authorization.authorize({
      requestId,
      capability,
      actor: session.principal.subject,
      resource,
      facts,
    });
  }

  private async allowAction(
    session: Session,
    requestId: string,
    capability: RevisionCapability,
    article: ArticleView,
    expectedVersion: number,
    resource = article.revision.id,
  ): Promise<void> {
    if (
      !(await this.decideAction(
        session,
        requestId,
        capability,
        article,
        expectedVersion,
        resource,
      ))
    ) {
      throw forbidden();
    }
  }

  private async allow(
    session: Session,
    requestId: string,
    capability: Capability,
    resource: string,
    facts: Record<string, boolean | number | string>,
  ): Promise<void> {
    if (
      !(await this.authorization.authorize({
        requestId,
        capability,
        actor: session.principal.subject,
        resource,
        facts,
      }))
    ) {
      throw forbidden();
    }
  }
}
