import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentDigest,
  decryptJson,
  encryptJson,
} from "../src/server/crypto.ts";
import { AppDatabase, resetDatabase } from "../src/server/database.ts";
import { fixture } from "./support.ts";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("editorial persistence", () => {
  it("creates a tenant-scoped article and first draft atomically", () => {
    const opened = fixture();
    cleanup = opened.cleanup;
    const articleId = opened.database.createArticle({
      tenantId: "tenant-a",
      authorId: opened.session.principal.id,
      title: "New guide",
      body: "Draft content",
    });
    const article = opened.database.article(articleId, "tenant-a");
    expect(article).toMatchObject({
      id: articleId,
      tenantId: "tenant-a",
      revision: {
        title: "New guide",
        body: "Draft content",
        authorId: "user-riley",
        state: "draft",
      },
    });
    expect(opened.database.article(articleId, "tenant-b")).toBeUndefined();
  });

  it("persists created articles across restarts and rolls back a failed first revision", () => {
    const o = fixture();
    cleanup = o.cleanup;
    const input = {
      tenantId: "tenant-a",
      authorId: "user-riley",
      title: "New article",
      body: "Original content",
    };
    const articleId = o.database.createArticle(input);
    const reopened = new AppDatabase(o.directory, "http://localhost:18004");
    const sql = new Database(resolve(o.directory, "p4.sqlite"));
    try {
      expect(reopened.article(articleId, "tenant-a")?.revision).toMatchObject({
        title: input.title,
        body: input.body,
        digest: contentDigest(input.title, input.body),
      });
      const before = sql
        .prepare("SELECT count(*) AS count FROM articles")
        .get();
      sql.exec(
        "CREATE TRIGGER fail_new_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
      );
      expect(() => reopened.createArticle(input)).toThrow("test write failure");
      expect(
        sql.prepare("SELECT count(*) AS count FROM articles").get(),
      ).toEqual(before);
    } finally {
      sql.close();
      reopened.close();
    }
  });
  it("seeds a bounded Tenant A queue and stable normalized digest", () => {
    const opened = fixture();
    cleanup = opened.cleanup;
    expect(opened.database.listArticles("tenant-a")).toHaveLength(4);
    expect(contentDigest("Cafe\u0301", "Body")).toBe(
      contentDigest("Café", "Body"),
    );
  });

  it("encrypts server-held token material", () => {
    const encrypted = encryptJson({ accessToken: "secret" }, "x".repeat(32));
    expect(encrypted).not.toContain("secret");
    expect(decryptJson(encrypted, "x".repeat(32))).toEqual({
      accessToken: "secret",
    });
  });

  it("resets live connections and sign-ins without replacing the database", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "p4-reset-test-"));
    const sentinel = resolve(directory, "keep.txt");
    writeFileSync(sentinel, "keep");
    const issuer = "http://localhost:18004";
    const database = new AppDatabase(directory, issuer);
    const observer = new AppDatabase(directory, issuer);
    try {
      database.revokeOmar();
      database.submit(
        "article-launch-brief",
        "tenant-a",
        "revision-launch-1",
        1,
      );
      database.review(
        "article-launch-brief",
        "tenant-a",
        "revision-launch-1",
        "user-ana",
        2,
        "approved",
        database.authority("user-ana", "tenant-a", "editor"),
      );
      database.publish("article-launch-brief", "tenant-a", "user-ana", 3, {
        publisher: database.authority("user-ana", "tenant-a", "publisher"),
        approval: database.latestApproval("article-launch-brief"),
      });
      database.createSession({
        idHash: "session",
        principalId: "user-riley",
        csrfToken: "csrf",
        encryptedTokens: "encrypted",
        expiresAt: Date.now() + 60_000,
      });
      database.createTransaction("login", {
        state: "state",
        nonce: "nonce",
        verifier: "verifier",
        expiresAt: Date.now() + 60_000,
      });
      expect(observer.session("session")).toBeDefined();
      expect(
        observer.article("article-launch-brief", "tenant-a")?.published,
      ).toBe(true);
      resetDatabase(directory, issuer);
      for (const connection of [database, observer]) {
        expect(connection.listArticles("tenant-a")).toHaveLength(4);
        expect(
          connection.authority("user-omar", "tenant-a", "editor"),
        ).toMatchObject({
          current: true,
          version: 1,
        });
        expect(
          connection.article("article-launch-brief", "tenant-a"),
        ).toMatchObject({
          version: 1,
          revision: { state: "draft" },
          review: undefined,
          published: false,
        });
        expect(connection.session("session")).toBeUndefined();
        expect(connection.consumeTransaction("login")).toBeUndefined();
      }
      database.submit(
        "article-launch-brief",
        "tenant-a",
        "revision-launch-1",
        1,
      );
      expect(
        observer.article("article-launch-brief", "tenant-a"),
      ).toMatchObject({
        version: 2,
        revision: { state: "submitted" },
      });
      observer.revokeOmar();
      expect(
        database.authority("user-omar", "tenant-a", "editor").current,
      ).toBe(false);
      expect(readFileSync(sentinel, "utf8")).toBe("keep");
    } finally {
      observer.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
