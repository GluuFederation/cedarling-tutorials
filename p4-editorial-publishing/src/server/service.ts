/** Loads trusted editorial facts, asks Cedarling, then performs one conditional effect. */
import { z } from "zod";
import type {
  AuthorizationRequest,
  AuthorizeEditorial,
} from "./authorization.ts";
import type { AppDatabase } from "./database.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
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
  constructor(
    private readonly database: AppDatabase,
    private readonly authorize: AuthorizeEditorial,
  ) {}

  async canCreate(session: Session, requestId: string): Promise<boolean> {
    return this.authorize({
      requestId,
      principal: session.principal,
      capability: "article.create",
      tenantId: session.principal.tenantId,
      phase: "preview",
    });
  }

  async create(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<string> {
    const content = this.content(form);
    await this.allow({
      requestId,
      principal: session.principal,
      capability: "article.create",
      tenantId: session.principal.tenantId,
    });
    return this.database.createArticle({
      ...content,
      tenantId: session.principal.tenantId,
      authorId: session.principal.id,
    });
  }

  /** UI guidance only: mutations reload facts and evaluate the policy again. */
  async availability(
    session: Session,
    article: ArticleView,
    requestId: string,
  ) {
    const base = {
      requestId,
      principal: session.principal,
      article,
      phase: "preview" as const,
    };
    const current = article.revision.id === article.currentRevisionId;
    const editor = this.database.authority(
      session.principal.id,
      article.tenantId,
      "editor",
    );
    const publisher = this.database.authority(
      session.principal.id,
      article.tenantId,
      "publisher",
    );
    const approval = this.database.latestApproval(article.id);
    return {
      edit:
        current &&
        (article.revision.state === "draft" || article.revisions.length < 20) &&
        (await this.authorize({ ...base, capability: "revision.edit" })),
      submit:
        current &&
        article.revision.state === "draft" &&
        (await this.authorize({ ...base, capability: "revision.submit" })),
      approve:
        current &&
        article.revision.state === "submitted" &&
        (await this.authorize({
          ...base,
          capability: "revision.approve",
          editorAuthorityCurrent: editor.current,
        })),
      reject:
        current &&
        article.revision.state === "submitted" &&
        (await this.authorize({
          ...base,
          capability: "revision.reject",
          editorAuthorityCurrent: editor.current,
        })),
      publish:
        current &&
        (await this.authorize({
          ...base,
          capability: "publication.publish",
          publisherAuthorityCurrent: publisher.current,
          approval,
        })),
    };
  }

  private content(form: FormData) {
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
    return content.data;
  }

  async list(session: Session, requestId: string): Promise<ArticleSummary[]> {
    const result: ArticleSummary[] = [];
    for (const article of this.database.listArticles(
      session.principal.tenantId,
    )) {
      if (
        await this.authorize({
          requestId,
          capability: "article.read",
          principal: session.principal,
          article: { id: article.id, tenantId: session.principal.tenantId },
        })
      )
        result.push(article);
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
      !(await this.authorize({
        requestId,
        capability: "article.read",
        principal: session.principal,
        article,
      }))
    )
      throw notFound();
    return article;
  }

  async saveDraft(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<string> {
    const articleId = this.parseId(form.get("articleId"));
    const version = this.parseVersion(form.get("expectedVersion"));
    const content = this.content(form);
    const article = this.current(session, articleId, version);
    await this.allow({
      requestId,
      capability: "revision.edit",
      principal: session.principal,
      article,
    });
    return this.database.saveDraft({
      articleId,
      tenantId: article.tenantId,
      actorId: session.principal.id,
      expectedVersion: version,
      ...content,
    });
  }

  async submit(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<void> {
    const values = this.mutationCandidates(form);
    const article = this.current(
      session,
      values.articleId,
      values.version,
      values.revisionId,
    );
    await this.allow({
      requestId,
      capability: "revision.submit",
      principal: session.principal,
      article,
    });
    this.database.submit(
      article.id,
      article.tenantId,
      article.revision.id,
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
    const article = this.current(
      session,
      values.articleId,
      values.version,
      values.revisionId,
    );
    const authority = this.database.authority(
      session.principal.id,
      article.tenantId,
      "editor",
    );
    await this.allow({
      requestId,
      capability:
        decision === "approved" ? "revision.approve" : "revision.reject",
      principal: session.principal,
      article,
      editorAuthorityCurrent: authority.current,
    });
    this.database.review(
      article.id,
      article.tenantId,
      article.revision.id,
      session.principal.id,
      values.version,
      decision,
      authority,
    );
  }

  async publish(
    session: Session,
    form: FormData,
    requestId: string,
  ): Promise<void> {
    const articleId = this.parseId(form.get("articleId"));
    const version = this.parseVersion(form.get("expectedVersion"));
    const article = this.current(session, articleId, version);
    const approval = this.database.latestApproval(articleId);
    const publisher = this.database.authority(
      session.principal.id,
      article.tenantId,
      "publisher",
    );
    await this.allow({
      requestId,
      capability: "publication.publish",
      principal: session.principal,
      article,
      publisherAuthorityCurrent: publisher.current,
      approval,
    });
    this.database.publish(
      articleId,
      article.tenantId,
      session.principal.id,
      version,
      { publisher, approval },
    );
  }

  private current(
    session: Session,
    articleId: string,
    version: number,
    revisionId?: string,
  ): ArticleView {
    const article = this.database.article(
      articleId,
      session.principal.tenantId,
    );
    if (!article) throw notFound();
    if (
      article.version !== version ||
      (revisionId !== undefined && article.currentRevisionId !== revisionId)
    )
      throw conflict();
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

  private async allow(request: AuthorizationRequest): Promise<void> {
    if (!(await this.authorize(request))) throw forbidden();
  }
}
