/** Proves real policy decisions and atomic editorial effects against isolated SQLite fixtures. */

import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type AuthorizeEditorial,
  createEditorialAuthorization,
} from "../src/server/authorization.ts";
import { AppDatabase } from "../src/server/database.ts";
import { unavailable } from "../src/server/errors.ts";
import { EditorialService } from "../src/server/service.ts";
import { fixture, form, present } from "./support.ts";

let authorization: Awaited<ReturnType<typeof createEditorialAuthorization>>;
const cleanups: Array<() => void> = [];
beforeAll(async () => {
  authorization = await createEditorialAuthorization();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
afterAll(async () => {
  await authorization?.close();
});
function open(
  subject = "riley",
  authorize: AuthorizeEditorial = authorization.authorize,
) {
  const result = fixture(subject);
  cleanups.push(result.cleanup);
  return {
    ...result,
    service: new EditorialService(result.database, authorize),
  };
}
function mutation(opened: ReturnType<typeof open>, articleId: string) {
  const article = present(opened.database.article(articleId, "tenant-a"));
  return form({
    articleId,
    revisionId: article.revision.id,
    expectedVersion: article.version,
  });
}
function as(opened: ReturnType<typeof open>, subject: string) {
  return {
    ...opened.session,
    principal: present(
      opened.database.principal("http://localhost:18004", subject),
    ),
  };
}
const launch = "article-launch-brief";
const migration = "article-migration-guide";
const partner = "article-partner-announcement";

describe("editorial enforcement", () => {
  it.each(["riley", "ana", "omar"])(
    "lets %s create and submit their own article, but not review it",
    async (subject) => {
      const o = open(subject);
      const articleId = await o.service.create(
        o.session,
        form({
          title: "New article",
          body: "Original content",
          authorId: "user-ana",
          tenantId: "tenant-b",
        }),
        "create",
      );
      expect(o.database.article(articleId, "tenant-b")).toBeUndefined();
      expect(o.database.article(articleId, "tenant-a")).toMatchObject({
        version: 1,
        revision: {
          version: 1,
          state: "draft",
          authorId: o.session.principal.id,
        },
      });
      await o.service.submit(o.session, mutation(o, articleId), "submit");
      await expect(
        o.service.review(
          o.session,
          mutation(o, articleId),
          "self-review",
          "approved",
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("returns policy-based UI availability without changing articles", async () => {
    const o = open();
    const article = present(o.database.article(migration, "tenant-a"));
    expect(
      await o.service.availability(o.session, article, "preview"),
    ).toMatchObject({
      edit: true,
      approve: false,
      reject: false,
      publish: false,
    });
    expect(
      await o.service.availability(as(o, "ana"), article, "preview"),
    ).toMatchObject({
      edit: false,
      approve: true,
      reject: true,
      publish: false,
    });
    expect(o.database.article(migration, "tenant-a")).toEqual(article);
  });

  it("does not create records on denied or unavailable decisions or invalid content", async () => {
    const o = open();
    const original = o.database.listArticles("tenant-a");
    for (const authorize of [
      async () => false,
      async () => {
        throw unavailable();
      },
    ]) {
      const service = new EditorialService(o.database, authorize);
      await expect(
        service.create(
          o.session,
          form({ title: "Title", body: "Content" }),
          "blocked",
        ),
      ).rejects.toBeDefined();
    }
    const authorize = vi.fn(authorization.authorize);
    const service = new EditorialService(o.database, authorize);
    for (const content of [
      { title: " ", body: "Content" },
      { title: "Title", body: " " },
      { title: "Title", body: "x".repeat(32769) },
    ]) {
      await expect(
        service.create(o.session, form(content), "invalid"),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(o.database.listArticles("tenant-a")).toEqual(original);
  });

  it("a preview allow does not survive editor revocation", async () => {
    const o = open("omar");
    expect(
      (
        await o.service.availability(
          o.session,
          present(o.database.article(partner, "tenant-a")),
          "preview",
        )
      ).approve,
    ).toBe(true);
    o.database.revokeOmar();
    await expect(
      o.service.review(o.session, mutation(o, partner), "effect", "approved"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects self-approval without recording review evidence", async () => {
    const o = open();
    await o.service.submit(o.session, mutation(o, launch), "submit");
    await expect(
      o.service.review(
        o.session,
        mutation(o, launch),
        "self-review",
        "approved",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(o.database.article(launch, "tenant-a")).toMatchObject({
      version: 2,
      revision: { state: "submitted" },
      review: undefined,
      published: false,
    });
  });

  it("requires a new approval after the author creates another revision", async () => {
    const o = open("ana");
    await o.service.review(
      o.session,
      mutation(o, migration),
      "review",
      "approved",
    );
    const previous = present(o.database.article(migration, "tenant-a"));
    const author = as(o, "riley");
    await o.service.saveDraft(
      author,
      form({
        articleId: migration,
        expectedVersion: previous.version,
        title: previous.revision.title,
        body: "Changed after approval.",
      }),
      "edit",
    );
    await o.service.submit(author, mutation(o, migration), "submit");
    await expect(
      o.service.publish(
        o.session,
        mutation(o, migration),
        "publish-unapproved",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(o.database.article(migration, "tenant-a")).toMatchObject({
      revision: { version: 2, state: "submitted" },
      published: false,
    });
    await o.service.review(
      o.session,
      mutation(o, migration),
      "new-review",
      "approved",
    );
    await o.service.publish(
      o.session,
      mutation(o, migration),
      "publish-approved",
    );
    expect(o.database.article(migration, "tenant-a")).toMatchObject({
      revision: { version: 2, state: "published" },
      published: true,
    });
    expect(
      o.database.article(migration, "tenant-a", previous.revision.id)?.revision
        .digest,
    ).toBe(previous.revision.digest);
  });

  it("rejects publication after the approver loses editor authority", async () => {
    const o = open("omar");
    await o.service.review(
      o.session,
      mutation(o, partner),
      "review",
      "approved",
    );
    o.database.revokeOmar();
    await expect(
      o.service.publish(as(o, "ana"), mutation(o, partner), "publish"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(o.database.article(partner, "tenant-a")).toMatchObject({
      version: 2,
      revision: { state: "approved" },
      published: false,
    });
  });

  it("finishes the valid author-reviewer-publisher flow once, rejecting stale replay", async () => {
    const o = open();
    await o.service.saveDraft(
      o.session,
      form({
        articleId: launch,
        expectedVersion: 1,
        title: "Launch brief",
        body: "Ready for review.",
      }),
      "edit",
    );
    await o.service.submit(o.session, mutation(o, launch), "submit");
    const reviewer = as(o, "ana");
    await o.service.review(
      reviewer,
      mutation(o, launch),
      "approve",
      "approved",
    );
    const publication = mutation(o, launch);
    await o.service.publish(reviewer, publication, "publish");
    await expect(
      o.service.publish(reviewer, publication, "replay"),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(o.database.article(launch, "tenant-a")).toMatchObject({
      version: 5,
      published: true,
    });
  });

  it("allows rejection, but not publication of rejected content", async () => {
    const o = open("ana");
    await o.service.review(
      o.session,
      mutation(o, migration),
      "reject",
      "rejected",
    );
    await expect(
      o.service.publish(o.session, mutation(o, migration), "publish"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(o.database.article(migration, "tenant-a")).toMatchObject({
      revision: { state: "rejected" },
      published: false,
    });
  });

  it("preserves owner-only editing and submission", async () => {
    const o = open("ana");
    await expect(
      o.service.saveDraft(
        o.session,
        form({
          articleId: launch,
          expectedVersion: 1,
          title: "Forged",
          body: "Forged",
        }),
        "edit",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      o.service.submit(o.session, mutation(o, launch), "submit"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(o.database.article(launch, "tenant-a")?.version).toBe(1);
  });

  it("hides inaccessible and missing articles and filters denied lists", async () => {
    const o = open();
    for (const id of ["article-private-tenant-b", "missing"]) {
      await expect(
        o.service.read(o.session, id, undefined, "read"),
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(
      (await o.service.list(o.session, "list")).map((a) => a.id),
    ).not.toContain("article-private-tenant-b");
    const denied = new EditorialService(o.database, async () => false);
    expect(await denied.list(o.session, "denied-list")).toEqual([]);
    await expect(
      denied.read(o.session, launch, undefined, "denied-read"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects stale and substituted revision candidates before authorization", async () => {
    const authorize = vi.fn(authorization.authorize);
    const o = open("ana", authorize);
    for (const values of [
      {
        articleId: migration,
        revisionId: "revision-launch-1",
        expectedVersion: 1,
      },
      {
        articleId: migration,
        revisionId: "revision-migration-1",
        expectedVersion: 2,
      },
    ]) {
      await expect(
        o.service.review(o.session, form(values), "invalid", "approved"),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    }
    expect(authorize).not.toHaveBeenCalled();
    expect(o.database.article(migration, "tenant-a")?.version).toBe(1);
  });

  it("rejects oversized content before authorization", async () => {
    const authorize = vi.fn(authorization.authorize);
    const o = open("riley", authorize);
    await expect(
      o.service.saveDraft(
        o.session,
        form({
          articleId: launch,
          expectedVersion: 1,
          title: "Bounded",
          body: "x".repeat(32769),
        }),
        "large",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("performs no mutation when authorization is unavailable", async () => {
    const o = open("riley", async () => {
      throw unavailable();
    });
    await expect(
      o.service.submit(o.session, mutation(o, launch), "unavailable"),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(o.database.article(launch, "tenant-a")?.version).toBe(1);
    await expect(
      o.service.read(o.session, launch, undefined, "unavailable-read"),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects content changed while a submission decision is pending", async () => {
    const o = open();
    const other = new AppDatabase(o.directory, "http://localhost:18004");
    cleanups.push(() => other.close());
    const service = new EditorialService(o.database, async (request) => {
      const allowed = await authorization.authorize(request);
      other.saveDraft({
        articleId: launch,
        tenantId: "tenant-a",
        actorId: "user-riley",
        expectedVersion: 1,
        title: "Updated launch brief",
        body: "Changed while Cedarling was evaluating the previous revision.",
      });
      return allowed;
    });
    await expect(
      service.submit(o.session, mutation(o, launch), "racing-submit"),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(o.database.article(launch, "tenant-a")).toMatchObject({
      version: 2,
      revision: { state: "draft", title: "Updated launch brief" },
    });
  });

  it.each(["reviewer", "publisher", "approval"] as const)(
    "rejects a %s change between publication decision and commit",
    async (changed) => {
      const o = open("omar");
      await o.service.review(
        o.session,
        mutation(o, partner),
        "review",
        "approved",
      );
      const connection = new Database(resolve(o.directory, "p4.sqlite"));
      cleanups.push(() => connection.close());
      const service = new EditorialService(o.database, async (request) => {
        const allowed = await authorization.authorize(request);
        if (request.capability === "publication.publish") {
          if (changed === "approval")
            connection
              .prepare(
                "UPDATE reviews SET digest = 'changed' WHERE article_id = ?",
              )
              .run(partner);
          else
            connection
              .prepare(
                "UPDATE authorities SET revoked_at = ?, version = version + 1 WHERE principal_id = ? AND role = ?",
              )
              .run(
                new Date().toISOString(),
                changed === "reviewer" ? "user-omar" : "user-ana",
                changed === "reviewer" ? "editor" : "publisher",
              );
        }
        return allowed;
      });
      await expect(
        service.publish(as(o, "ana"), mutation(o, partner), "racing-publish"),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
      expect(o.database.article(partner, "tenant-a")).toMatchObject({
        version: 2,
        published: false,
      });
    },
  );

  it("rejects editor revocation between review decision and commit", async () => {
    const o = open("omar");
    const other = new AppDatabase(o.directory, "http://localhost:18004");
    cleanups.push(() => other.close());
    const service = new EditorialService(o.database, async (request) => {
      const allowed = await authorization.authorize(request);
      other.revokeOmar();
      return allowed;
    });
    await expect(
      service.review(
        o.session,
        mutation(o, partner),
        "racing-review",
        "approved",
      ),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(o.database.article(partner, "tenant-a")).toMatchObject({
      version: 1,
      review: undefined,
      revision: { state: "submitted" },
    });
  });
});
