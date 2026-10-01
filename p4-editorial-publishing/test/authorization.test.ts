/** Exercises the actual P4 archive through the pinned Cedarling SDK. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type AuthorizationRequest,
  createEditorialAuthorization,
} from "../src/server/authorization.ts";
import type { Approval, ArticleView } from "../src/server/models.ts";

let authorization: Awaited<ReturnType<typeof createEditorialAuthorization>>;
beforeAll(async () => {
  authorization = await createEditorialAuthorization();
});
afterAll(async () => {
  await authorization?.close();
});

const article: ArticleView = {
  id: "article-test",
  tenantId: "tenant-a",
  version: 2,
  currentRevisionId: "revision-test",
  revision: {
    id: "revision-test",
    version: 1,
    title: "Title",
    body: "Body",
    digest: "digest-test",
    authorId: "user-riley",
    authorName: "Riley",
    state: "submitted",
  },
  revisions: [],
  published: false,
};
const approval: Approval = {
  id: "review-test",
  revisionId: "revision-test",
  revisionVersion: 1,
  digest: "digest-test",
  reviewerId: "user-omar",
  authorityCurrent: true,
  authorityVersion: 1,
};
const principal = { id: "user-ana", tenantId: "tenant-a" };
const read = (): AuthorizationRequest => ({
  requestId: "policy-read",
  principal,
  article,
  capability: "article.read",
});
const publish = (): AuthorizationRequest & {
  capability: "publication.publish";
} => ({
  requestId: "policy-publish",
  principal,
  article: { ...article, revision: { ...article.revision, state: "approved" } },
  capability: "publication.publish",
  publisherAuthorityCurrent: true,
  approval,
});

describe("editorial policies", () => {
  it("permits creation only in the principal's tenant and logs full Cedarling evidence", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const request = {
        requestId: "create-proof",
        principal,
        capability: "article.create" as const,
        tenantId: "tenant-a",
      };
      expect(await authorization.authorize(request)).toBe(true);
      expect(
        await authorization.authorize({ ...request, tenantId: "tenant-b" }),
      ).toBe(false);
      const logs = info.mock.calls.map(([value]) => JSON.parse(String(value)));
      const context = logs.find((log) => log.event === "authorization.context");
      expect(context).toMatchObject({
        requestId: "create-proof",
        actorId: principal.id,
        capability: "article.create",
        phase: "enforcement",
      });
      const decision = logs.find(
        (log) =>
          log.request_id === context.cedarlingRequestId &&
          log.log_kind === "Decision",
      );
      expect(decision).toMatchObject({
        decision: "ALLOW",
        diagnostics: {
          reason: expect.arrayContaining([
            expect.objectContaining({ id: "create-tenant-article" }),
          ]),
          errors: [],
        },
      });
    } finally {
      info.mockRestore();
    }
  });
  it("limits reads to the principal's tenant", async () => {
    expect(await authorization.authorize(read())).toBe(true);
    expect(
      await authorization.authorize({
        ...read(),
        principal: { ...principal, tenantId: "tenant-b" },
      }),
    ).toBe(false);
  });

  it.each(["revision.edit", "revision.submit"] as const)(
    "allows only the author to %s",
    async (capability) => {
      const request = {
        requestId: capability,
        capability,
        article,
        principal: { ...principal, id: "user-riley" },
      };
      expect(await authorization.authorize(request)).toBe(true);
      expect(await authorization.authorize({ ...request, principal })).toBe(
        false,
      );
      expect(
        await authorization.authorize({
          ...request,
          principal: { ...request.principal, tenantId: "tenant-b" },
        }),
      ).toBe(false);
    },
  );

  it.each(["revision.approve", "revision.reject"] as const)(
    "requires an independent current editor for %s",
    async (capability) => {
      const request = {
        requestId: capability,
        capability,
        article,
        principal,
        editorAuthorityCurrent: true,
      };
      expect(await authorization.authorize(request)).toBe(true);
      expect(
        await authorization.authorize({
          ...request,
          editorAuthorityCurrent: false,
        }),
      ).toBe(false);
      expect(
        await authorization.authorize({
          ...request,
          principal: { ...principal, id: "user-riley" },
        }),
      ).toBe(false);
      expect(
        await authorization.authorize({
          ...request,
          principal: { ...principal, tenantId: "tenant-b" },
        }),
      ).toBe(false);
      expect(
        await authorization.authorize({
          ...request,
          article: {
            ...article,
            revision: { ...article.revision, state: "draft" },
          },
        }),
      ).toBe(false);
    },
  );

  it("permits publication with exact evidence and current authority", async () => {
    expect(await authorization.authorize(publish())).toBe(true);
  });

  it.each([
    { revisionId: "another-revision" },
    { revisionVersion: 2 },
    { digest: "another-digest" },
    { reviewerId: "user-riley" },
    { authorityCurrent: false },
  ])("denies publication with invalid approval %j", async (changed) => {
    expect(
      await authorization.authorize({
        ...publish(),
        approval: { ...approval, ...changed },
      }),
    ).toBe(false);
  });

  it("requires an approval and a current publisher in the same tenant", async () => {
    expect(
      await authorization.authorize({ ...publish(), approval: undefined }),
    ).toBe(false);
    expect(
      await authorization.authorize({
        ...publish(),
        publisherAuthorityCurrent: false,
      }),
    ).toBe(false);
    expect(
      await authorization.authorize({
        ...publish(),
        principal: { ...principal, tenantId: "tenant-b" },
      }),
    ).toBe(false);
  });

  it.each(["draft", "submitted", "rejected", "published"] as const)(
    "does not publish a %s revision",
    async (state) => {
      const request = publish();
      expect(
        await authorization.authorize({
          ...request,
          article: { ...article, revision: { ...article.revision, state } },
        }),
      ).toBe(false);
    },
  );

  it("fails closed for an invalid authorization request", async () => {
    const request = publish();
    request.article.revision.version = Number.NaN;
    await expect(authorization.authorize(request)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("rejects a missing policy archive", async () => {
    await expect(
      createEditorialAuthorization("/missing-p4-policy-store.cjar"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an archive with invalid policy syntax", async () => {
    const directory = await mkdtemp(join(tmpdir(), "p4-invalid-policy-"));
    try {
      const files = unzipSync(await readFile(".local/policy-store.cjar"));
      files["policies/editorial.cedar"] = strToU8("not a Cedar policy");
      const archivePath = join(directory, "invalid.cjar");
      await writeFile(archivePath, zipSync(files));
      await expect(
        createEditorialAuthorization(archivePath),
      ).rejects.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
