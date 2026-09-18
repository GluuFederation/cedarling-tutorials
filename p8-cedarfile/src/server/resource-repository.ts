import type Database from "better-sqlite3";
import { limits } from "./config.ts";
import { DomainError } from "./errors.ts";
import type { Resource, ShareRole, User } from "./models.ts";
import type { StagedContent } from "./storage.ts";

export class ResourceRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  getResource(id: string): Resource | undefined {
    return this.mapResource(
      this.database.prepare("SELECT * FROM resources WHERE id = ?").get(id),
    );
  }

  listResources(): Resource[] {
    return (
      this.database
        .prepare("SELECT * FROM resources ORDER BY name_key, id")
        .all() as unknown[]
    ).map((row) => this.mapRequiredResource(row));
  }

  listChildren(parentId: string): Resource[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM resources WHERE parent_id = ? ORDER BY name_key, id",
        )
        .all(parentId) as unknown[]
    ).map((row) => this.mapRequiredResource(row));
  }

  descendants(id: string): Resource[] {
    return (
      this.database
        .prepare(`WITH RECURSIVE tree(id, depth) AS (
          SELECT id, 0 FROM resources WHERE id = ?
          UNION ALL
          SELECT r.id, tree.depth + 1 FROM resources r JOIN tree ON r.parent_id = tree.id
        ) SELECT resources.* FROM resources JOIN tree USING(id) ORDER BY tree.depth DESC`)
        .all(id) as unknown[]
    ).map((row) => this.mapRequiredResource(row));
  }

  breadcrumbs(resource: Resource): Resource[] {
    return (
      this.database
        .prepare(`WITH RECURSIVE parents(id, parent_id, depth) AS (
          SELECT id, parent_id, 0 FROM resources WHERE id = ?
          UNION ALL
          SELECT r.id, r.parent_id, parents.depth + 1 FROM resources r JOIN parents ON parents.parent_id = r.id
        ) SELECT resources.* FROM resources JOIN parents USING(id) ORDER BY parents.depth DESC`)
        .all(resource.id) as unknown[]
    ).map((row) => this.mapRequiredResource(row));
  }

  effectiveShare(resourceId: string, userId: string): ShareRole | null {
    const row = this.database
      .prepare(`WITH RECURSIVE parents(id, parent_id, depth) AS (
        SELECT id, parent_id, 0 FROM resources WHERE id = ?
        UNION ALL
        SELECT r.id, r.parent_id, parents.depth + 1 FROM resources r JOIN parents ON parents.parent_id = r.id
      ) SELECT shares.role FROM parents JOIN shares ON shares.resource_id = parents.id
        WHERE shares.user_id = ? ORDER BY CASE shares.role WHEN 'editor' THEN 0 ELSE 1 END, parents.depth LIMIT 1`)
      .get(resourceId, userId) as { role: ShareRole } | undefined;
    return row?.role ?? null;
  }

  isVisible(user: User, resource: Resource): boolean {
    return (
      (user.workspaceRole === "owner" &&
        user.homeWorkspaceId === resource.workspaceId) ||
      this.effectiveShare(resource.id, user.id) !== null
    );
  }

  workspaceUsage(workspaceId: string): { count: number; bytes: number } {
    const row = this.database
      .prepare(
        "SELECT COUNT(*) count, COALESCE(SUM(size), 0) bytes FROM resources WHERE workspace_id = ?",
      )
      .get(workspaceId) as { count: number; bytes: number };
    return { count: Number(row.count), bytes: Number(row.bytes) };
  }

  assertCapacity(workspaceId: string, bytes: number, replacedBytes = 0): void {
    const usage = this.workspaceUsage(workspaceId);
    if (usage.count >= limits.workspaceResources && replacedBytes === 0) {
      throw new DomainError("workspace_resource_limit", 413);
    }
    if (usage.bytes - replacedBytes + bytes > limits.workspaceBytes) {
      throw new DomainError("workspace_quota_exceeded", 413);
    }
  }

  assertNameAvailable(
    workspaceId: string,
    parentId: string,
    nameKey: string,
    exceptId?: string,
  ): void {
    const row = this.database
      .prepare(
        "SELECT id FROM resources WHERE workspace_id = ? AND parent_id = ? AND name_key = ? AND id <> COALESCE(?, '')",
      )
      .get(workspaceId, parentId, nameKey, exceptId) as
      | { id: string }
      | undefined;
    if (row) throw new DomainError("name_collision", 409);
  }

  insertResource(input: {
    id: string;
    workspaceId: string;
    parentId: string;
    kind: Resource["kind"];
    name: string;
    nameKey: string;
    ownerId: string;
    mediaType: string | null;
    size: number;
  }): Resource {
    const now = new Date().toISOString();
    this.database
      .prepare(`INSERT INTO resources
        (id, workspace_id, parent_id, kind, name, name_key, owner_id, media_type, size, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .run(
        input.id,
        input.workspaceId,
        input.parentId,
        input.kind,
        input.name,
        input.nameKey,
        input.ownerId,
        input.mediaType,
        input.size,
        now,
      );
    return this.requireStoredResource(input.id);
  }

  replaceFile(
    staged: StagedContent,
    id: string,
    version: number,
    mediaType: string,
    size: number,
  ): Resource {
    return this.database.transaction(() => {
      const result = this.database
        .prepare(`UPDATE resources SET media_type = ?, size = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? AND kind = 'file'`)
        .run(mediaType, size, new Date().toISOString(), id, version);
      if (result.changes !== 1) {
        throw new DomainError("stale_resource_version", 409);
      }
      this.recordCleanup(staged);
      return this.requireStoredResource(id);
    })();
  }

  moveResource(id: string, destinationId: string, version: number): Resource {
    const destination = this.getResource(destinationId);
    const resource = this.getResource(id);
    if (destination?.kind !== "folder" || !resource) {
      throw new DomainError("resource_not_found", 404);
    }
    if (destination.workspaceId !== resource.workspaceId) {
      throw new DomainError("cross_workspace_move", 400);
    }
    if (this.descendants(id).some((item) => item.id === destinationId)) {
      throw new DomainError("invalid_move", 400);
    }
    this.assertNameAvailable(
      resource.workspaceId,
      destinationId,
      resource.name.toLowerCase(),
      id,
    );
    const result = this.database
      .prepare(
        "UPDATE resources SET parent_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .run(destinationId, new Date().toISOString(), id, version);
    if (result.changes !== 1)
      throw new DomainError("stale_resource_version", 409);
    return this.requireStoredResource(id);
  }

  setShare(
    resourceId: string,
    userId: string,
    role: ShareRole,
    version: number,
  ): Resource {
    const transaction = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          "UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        )
        .run(new Date().toISOString(), resourceId, version);
      if (updated.changes !== 1)
        throw new DomainError("stale_resource_version", 409);
      if (!this.hasUser(userId))
        throw new DomainError("unknown_share_recipient", 400);
      this.database
        .prepare(`INSERT INTO shares (resource_id, user_id, role) VALUES (?, ?, ?)
          ON CONFLICT(resource_id, user_id) DO UPDATE SET role = excluded.role`)
        .run(resourceId, userId, role);
      return this.requireStoredResource(resourceId);
    });
    return transaction();
  }

  revokeShare(resourceId: string, userId: string, version: number): Resource {
    const transaction = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          "UPDATE resources SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
        )
        .run(new Date().toISOString(), resourceId, version);
      if (updated.changes !== 1)
        throw new DomainError("stale_resource_version", 409);
      this.database
        .prepare("DELETE FROM shares WHERE resource_id = ? AND user_id = ?")
        .run(resourceId, userId);
      return this.requireStoredResource(resourceId);
    });
    return transaction();
  }

  shares(
    resourceId: string,
  ): Array<{ userId: string; name: string; role: ShareRole }> {
    return this.database
      .prepare(`SELECT shares.user_id userId, users.name, shares.role
        FROM shares JOIN users ON users.id = shares.user_id WHERE shares.resource_id = ? ORDER BY users.name`)
      .all(resourceId) as Array<{
      userId: string;
      name: string;
      role: ShareRole;
    }>;
  }

  deleteTree(staged: StagedContent, rootId: string, version: number): void {
    const tree = this.descendants(rootId);
    if (tree.length === 0) throw new DomainError("resource_not_found", 404);
    if (tree.length - 1 > limits.recursiveResources) {
      throw new DomainError("recursive_limit_exceeded", 413);
    }
    const current = tree.find((item) => item.id === rootId);
    if (current?.version !== version)
      throw new DomainError("stale_resource_version", 409);
    this.database.transaction(() => {
      for (const item of tree) {
        this.database
          .prepare("DELETE FROM resources WHERE id = ?")
          .run(item.id);
      }
      this.recordCleanup(staged);
    })();
  }

  markDeleteClean(operationId: string): void {
    this.database
      .prepare("UPDATE delete_operations SET cleanup_pending = 0 WHERE id = ?")
      .run(operationId);
  }

  pendingDeletes(): StagedContent[] {
    return (
      this.database
        .prepare(
          "SELECT id, resource_ids FROM delete_operations WHERE cleanup_pending = 1",
        )
        .all() as Array<{ id: string; resource_ids: string }>
    ).map((row) => ({
      operationId: row.id,
      resourceIds: JSON.parse(row.resource_ids) as string[],
    }));
  }

  private recordCleanup(staged: StagedContent): void {
    this.database
      .prepare(
        "INSERT INTO delete_operations (id, resource_ids, cleanup_pending, created_at) VALUES (?, ?, 1, ?)",
      )
      .run(
        staged.operationId,
        JSON.stringify(staged.resourceIds),
        new Date().toISOString(),
      );
  }

  private requireStoredResource(id: string): Resource {
    const resource = this.getResource(id);
    if (!resource) throw new Error("resource_mapping_failed");
    return resource;
  }

  private mapRequiredResource(value: unknown): Resource {
    const resource = this.mapResource(value);
    if (!resource) throw new Error("resource_mapping_failed");
    return resource;
  }

  private mapResource(value: unknown): Resource | undefined {
    const row = value as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      kind: String(row.kind) as Resource["kind"],
      name: String(row.name),
      ownerId: String(row.owner_id),
      mediaType: row.media_type === null ? null : String(row.media_type),
      size: Number(row.size),
      version: Number(row.version),
      updatedAt: String(row.updated_at),
    };
  }

  private hasUser(id: string): boolean {
    return Boolean(
      this.database.prepare("SELECT 1 FROM users WHERE id = ?").get(id),
    );
  }
}
