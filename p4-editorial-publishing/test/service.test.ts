import { afterEach, describe, expect, it } from "vitest";
import { BaselineAuthorizationGateway } from "../src/server/authorization.ts";
import { EditorialService } from "../src/server/service.ts";
import { fixture, form, present } from "./support.ts";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("editorial authorization boundaries", () => {
  it("previews the baseline decision without hiding its self-approval gap", async () => {
    const opened = fixture("riley");
    cleanup = opened.cleanup;
    const service = new EditorialService(
      opened.database,
      new BaselineAuthorizationGateway(),
    );
    const draft = present(
      opened.database.article("article-launch-brief", "tenant-a"),
    );
    expect(
      await service.availability(opened.session, draft, "request-draft"),
    ).toMatchObject({ edit: true, submit: true });

    await service.submit(
      opened.session,
      form({
        articleId: draft.id,
        revisionId: draft.revision.id,
        expectedVersion: draft.version,
      }),
      "request-submit",
    );
    const submitted = present(opened.database.article(draft.id, "tenant-a"));
    expect(
      await service.availability(opened.session, submitted, "request-riley"),
    ).toEqual({
      edit: true,
      submit: false,
      approve: true,
      reject: false,
      publish: false,
    });
    await expect(
      service.review(
        opened.session,
        form({
          articleId: submitted.id,
          revisionId: submitted.revision.id,
          expectedVersion: submitted.version,
        }),
        "request-reject",
        "rejected",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      opened.database.article(submitted.id, "tenant-a")?.revision.state,
    ).toBe("submitted");

    const ana = present(
      opened.database.principal("http://localhost:18004", "ana"),
    );
    expect(
      await service.availability(
        { ...opened.session, principal: ana },
        submitted,
        "request-ana",
      ),
    ).toEqual({
      edit: false,
      submit: false,
      approve: true,
      reject: true,
      publish: false,
    });

    const omar = present(
      opened.database.principal("http://localhost:18004", "omar"),
    );
    const omarSession = { ...opened.session, principal: omar };
    expect(
      (await service.availability(omarSession, submitted, "request-omar"))
        .approve,
    ).toBe(true);
    expect(opened.database.revokeOmar()).toBe(true);
    await expect(
      service.review(
        omarSession,
        form({
          articleId: submitted.id,
          revisionId: submitted.revision.id,
          expectedVersion: submitted.version,
        }),
        "request-omar-revoked",
        "approved",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates an article through the fake authorization seam", async () => {
    const opened = fixture("riley");
    cleanup = opened.cleanup;
    expect(
      await opened.service.canCreate(opened.session, "request-preview"),
    ).toBe(true);
    const articleId = await opened.service.create(
      opened.session,
      form({ title: "New guide", body: "Draft content" }),
      "request-create",
    );
    expect(opened.requests.at(-1)).toMatchObject({
      capability: "article.create",
      facts: { tenantMatch: true },
    });
    expect(
      opened.database.article(articleId, "tenant-a")?.revision,
    ).toMatchObject({
      authorId: "user-riley",
      state: "draft",
    });
  });

  it("rejects invalid or denied article creation without persistence", async () => {
    const opened = fixture("riley", false);
    cleanup = opened.cleanup;
    const before = opened.database.listArticles("tenant-a");
    await expect(
      opened.service.create(
        opened.session,
        form({ title: "", body: "Body" }),
        "invalid",
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      opened.service.create(
        opened.session,
        form({ title: "Denied", body: "Body" }),
        "denied",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(opened.database.listArticles("tenant-a")).toEqual(before);
  });

  it("reproduces self-approval with the separation fact exposed", async () => {
    const opened = fixture("riley");
    cleanup = opened.cleanup;
    const article = present(
      opened.database.article("article-launch-brief", "tenant-a"),
    );
    await opened.service.submit(
      opened.session,
      form({
        articleId: article.id,
        revisionId: article.revision.id,
        expectedVersion: article.version,
      }),
      "request-submit",
    );
    const submitted = present(opened.database.article(article.id, "tenant-a"));
    await opened.service.review(
      opened.session,
      form({
        articleId: article.id,
        revisionId: submitted.revision.id,
        expectedVersion: submitted.version,
      }),
      "request-approve",
      "approved",
    );
    expect(opened.requests.at(-1)).toMatchObject({
      capability: "revision.approve",
      facts: { selfReview: true, editorAuthorityCurrent: false },
    });
    expect(
      opened.database.article(article.id, "tenant-a")?.revision.state,
    ).toBe("approved");
  });

  it("reproduces approval reuse across revisions", async () => {
    const opened = fixture("ana");
    cleanup = opened.cleanup;
    const first = present(
      opened.database.article("article-migration-guide", "tenant-a"),
    );
    await opened.service.review(
      opened.session,
      form({
        articleId: first.id,
        revisionId: first.revision.id,
        expectedVersion: first.version,
      }),
      "request-review",
      "approved",
    );
    const riley = present(
      opened.database.principal("http://localhost:18004", "riley"),
    );
    const rileySession = { ...opened.session, principal: riley };
    const approved = present(opened.database.article(first.id, "tenant-a"));
    const revisionId = await opened.service.saveDraft(
      rileySession,
      form({
        articleId: first.id,
        expectedVersion: approved.version,
        title: approved.revision.title,
        body: `${approved.revision.body}\nUpdated after approval.`,
      }),
      "request-edit",
    );
    const draft = present(opened.database.article(first.id, "tenant-a"));
    await opened.service.submit(
      rileySession,
      form({ articleId: first.id, revisionId, expectedVersion: draft.version }),
      "request-submit",
    );
    const current = present(opened.database.article(first.id, "tenant-a"));
    await opened.service.publish(
      opened.session,
      form({ articleId: first.id, expectedVersion: current.version }),
      "request-publish",
    );
    expect(opened.requests.at(-1)).toMatchObject({
      capability: "publication.publish",
      facts: {
        approvalPresent: true,
        approvalMatchesRevision: false,
        approvalMatchesDigest: false,
      },
    });
    expect(opened.database.article(first.id, "tenant-a")?.revision.state).toBe(
      "published",
    );
  });

  it("reproduces approval use after reviewer revocation", async () => {
    const opened = fixture("omar");
    cleanup = opened.cleanup;
    const article = present(
      opened.database.article("article-partner-announcement", "tenant-a"),
    );
    await opened.service.review(
      opened.session,
      form({
        articleId: article.id,
        revisionId: article.revision.id,
        expectedVersion: article.version,
      }),
      "request-review",
      "approved",
    );
    expect(opened.database.revokeOmar()).toBe(true);
    const ana = present(
      opened.database.principal("http://localhost:18004", "ana"),
    );
    const current = present(opened.database.article(article.id, "tenant-a"));
    await opened.service.publish(
      { ...opened.session, principal: ana },
      form({ articleId: article.id, expectedVersion: current.version }),
      "request-publish",
    );
    expect(opened.requests.at(-1)).toMatchObject({
      facts: { reviewerAuthorityCurrent: false, approvalMatchesRevision: true },
    });
  });

  it("performs no effect after an authorization denial", async () => {
    const opened = fixture("riley", false);
    cleanup = opened.cleanup;
    const article = present(
      opened.database.article("article-launch-brief", "tenant-a"),
    );
    await expect(
      opened.service.submit(
        opened.session,
        form({
          articleId: article.id,
          revisionId: article.revision.id,
          expectedVersion: article.version,
        }),
        "request-denied",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      opened.database.article(article.id, "tenant-a")?.revision.state,
    ).toBe("draft");
  });

  it("does not disclose another tenant article", async () => {
    const opened = fixture();
    cleanup = opened.cleanup;
    await expect(
      opened.service.read(
        opened.session,
        "article-private-tenant-b",
        undefined,
        "request-read",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("maps an authorization-denied read to not found", async () => {
    const opened = fixture("riley", false);
    cleanup = opened.cleanup;
    await expect(
      opened.service.read(
        opened.session,
        "article-launch-brief",
        undefined,
        "request-read-denied",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not invent editor authority for a self-reviewer", async () => {
    const opened = fixture("riley");
    cleanup = opened.cleanup;
    const article = present(
      opened.database.article("article-launch-brief", "tenant-a"),
    );
    await opened.service.submit(
      opened.session,
      form({
        articleId: article.id,
        revisionId: article.revision.id,
        expectedVersion: article.version,
      }),
      "request-submit",
    );
    const submitted = present(opened.database.article(article.id, "tenant-a"));
    await opened.service.review(
      opened.session,
      form({
        articleId: article.id,
        revisionId: submitted.revision.id,
        expectedVersion: submitted.version,
      }),
      "request-self-review",
      "approved",
    );

    expect(
      opened.database.article(article.id, "tenant-a")?.review,
    ).toMatchObject({ reviewerName: "Riley", authorityCurrent: false });
    expect(opened.database.latestApproval(article.id)?.authorityCurrent).toBe(
      false,
    );
  });

  it("does not publish draft or rejected revisions", () => {
    const opened = fixture("ana");
    cleanup = opened.cleanup;
    const draft = present(
      opened.database.article("article-launch-brief", "tenant-a"),
    );
    expect(() =>
      opened.database.publish(
        draft.id,
        draft.tenantId,
        opened.session.principal.id,
        draft.version,
      ),
    ).toThrow("Only a reviewable revision can be published");

    const submitted = present(
      opened.database.article("article-migration-guide", "tenant-a"),
    );
    opened.database.review(
      submitted.id,
      submitted.tenantId,
      submitted.revision.id,
      opened.session.principal.id,
      submitted.version,
      "rejected",
    );
    const rejected = present(
      opened.database.article(submitted.id, submitted.tenantId),
    );
    expect(() =>
      opened.database.publish(
        rejected.id,
        rejected.tenantId,
        opened.session.principal.id,
        rejected.version,
      ),
    ).toThrow("Only a reviewable revision can be published");
  });

  it("rejects stale and duplicate publication effects", async () => {
    const opened = fixture("ana");
    cleanup = opened.cleanup;
    const article = present(
      opened.database.article("article-editorial-handbook", "tenant-a"),
    );
    await opened.service.review(
      opened.session,
      form({
        articleId: article.id,
        revisionId: article.revision.id,
        expectedVersion: article.version,
      }),
      "request-review",
      "approved",
    );
    const approved = present(opened.database.article(article.id, "tenant-a"));
    await opened.service.publish(
      opened.session,
      form({ articleId: article.id, expectedVersion: approved.version }),
      "request-publish",
    );
    await expect(
      opened.service.publish(
        opened.session,
        form({ articleId: article.id, expectedVersion: approved.version }),
        "request-replay",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an oversized body before authorization", async () => {
    const opened = fixture();
    cleanup = opened.cleanup;
    const article = present(
      opened.database.article("article-launch-brief", "tenant-a"),
    );
    await expect(
      opened.service.saveDraft(
        opened.session,
        form({
          articleId: article.id,
          expectedVersion: article.version,
          title: "Bounded",
          body: "x".repeat(32_769),
        }),
        "request-large",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(opened.requests).toHaveLength(0);
  });
});
