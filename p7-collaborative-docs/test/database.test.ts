import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase, DomainError } from "../src/server/database.ts";

const directories: string[] = [];
const databases: AppDatabase[] = [];

function database(): AppDatabase {
  const directory = mkdtempSync(resolve(tmpdir(), "p7-database-"));
  directories.push(directory);
  const instance = new AppDatabase(
    resolve(directory, "test.sqlite"),
    "http://idp.localhost:4000",
  );
  databases.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of databases.splice(0)) instance.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("collaborative document repository", () => {
  it("seeds a shared document and a private document", () => {
    const db = database();
    expect(db.listDocuments("user-noah")).toEqual([
      expect.objectContaining({ id: "doc-launch-brief", role: "editor" }),
      expect.objectContaining({ id: "doc-private-planning", role: null }),
    ]);
    expect(db.findDocument("doc-launch-brief", "user-lena")).toMatchObject({
      role: "commenter",
    });
    expect(db.documentRelations("doc-launch-brief")).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ userId: "user-maya", role: "owner" }),
      ]),
    });
  });

  it("keeps document and access versions independent", () => {
    const db = database();
    db.updateDocument({
      documentId: "doc-launch-brief",
      expectedDocumentVersion: 1,
      title: "Launch brief",
      content: "Updated launch plan.",
    });
    db.setAccess({
      documentId: "doc-launch-brief",
      userId: "user-lena",
      role: "editor",
      expectedAccessVersion: 1,
    });
    expect(db.findDocument("doc-launch-brief", "user-lena")).toMatchObject({
      documentVersion: 2,
      accessVersion: 2,
      role: "editor",
    });
    expect(() =>
      db.updateDocument({
        documentId: "doc-launch-brief",
        expectedDocumentVersion: 1,
        title: "Stale",
        content: "Stale",
      }),
    ).toThrowError(new DomainError("state_conflict", 409));
  });

  it("preserves immutable ownership and idempotent comments", () => {
    const db = database();
    expect(() =>
      db.removeAccess({
        documentId: "doc-launch-brief",
        userId: "user-maya",
        expectedAccessVersion: 1,
      }),
    ).toThrowError(new DomainError("owner_is_immutable", 409));
    const command = {
      documentId: "doc-launch-brief",
      principalId: "user-lena",
      idempotencyKey: randomUUID(),
      body: "Ready for review.",
    };
    const first = db.addComment(command);
    const replay = db.addComment(command);
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      replayed: true,
      comment: { id: first.comment.id },
    });
    expect(() => db.addComment({ ...command, body: "Changed" })).toThrowError(
      new DomainError("idempotency_conflict", 409),
    );
  });
});
