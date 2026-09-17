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

export class EditorialService {
  private readonly database: AppDatabase;
  private readonly authorization: AuthorizationGateway;

  constructor(database: AppDatabase, authorization: AuthorizationGateway) {
    this.database = database;
    this.authorization = authorization;
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
    await this.allow(session, requestId, "revision.edit", current.revision.id, {
      actorIsAuthor: current.revision.authorId === session.principal.id,
      revisionState: current.revision.state,
      expectedVersion: version,
    });
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
    await this.allow(session, requestId, "revision.submit", values.revisionId, {
      actorIsAuthor: current.revision.authorId === session.principal.id,
      revisionState: current.revision.state,
      expectedVersion: values.version,
    });
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
    await this.allow(session, requestId, capability, values.revisionId, {
      selfReview: current.revision.authorId === session.principal.id,
      editorAuthorityCurrent: this.database.hasCurrentAuthority(
        session.principal.id,
        current.tenantId,
        "editor",
      ),
      revisionState: current.revision.state,
      expectedVersion: values.version,
    });
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
    const approval = this.database.latestApproval(articleId);
    await this.allow(
      session,
      requestId,
      "publication.publish",
      current.revision.id,
      {
        publisherAuthorityCurrent: this.database.hasCurrentAuthority(
          session.principal.id,
          current.tenantId,
          "publisher",
        ),
        approvalPresent: Boolean(approval),
        approvalMatchesRevision: approval?.revisionId === current.revision.id,
        approvalMatchesDigest: approval?.digest === current.revision.digest,
        reviewerAuthorityCurrent: approval?.authorityCurrent ?? false,
        expectedVersion: version,
      },
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
