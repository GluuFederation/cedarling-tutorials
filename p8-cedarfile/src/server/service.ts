import { limits } from "./config.ts";
import { randomToken } from "./crypto.ts";
import { DomainError } from "./errors.ts";
import type { Resource, ShareRole, User } from "./models.ts";
import type { ResourceRepository } from "./resource-repository.ts";
import type { SafeStorage, StagedContent } from "./storage.ts";
import {
  normalizeVirtualName,
  parseResourceId,
  validateContent,
} from "./validation.ts";

export type ResourceView = Resource &
  Readonly<{
    access: "owner" | ShareRole | "none";
  }>;

type BeforeEffect = (resource: ResourceView) => void;

export class FileService {
  private readonly repository: ResourceRepository;
  private readonly storage: SafeStorage;

  constructor(repository: ResourceRepository, storage: SafeStorage) {
    this.repository = repository;
    this.storage = storage;
  }

  private access(user: User, resource: Resource): ResourceView["access"] {
    if (
      user.workspaceRole === "owner" &&
      user.homeWorkspaceId === resource.workspaceId
    ) {
      return "owner";
    }
    return this.repository.effectiveShare(resource.id, user.id) ?? "none";
  }

  view(user: User, resource: Resource): ResourceView {
    return { ...resource, access: this.access(user, resource) };
  }

  list(
    user: User,
    parentId?: string,
  ): {
    folder: ResourceView | null;
    resources: ResourceView[];
  } {
    if (parentId) {
      const parent = this.requireResource(parentId);
      if (parent.kind !== "folder")
        throw new DomainError("resource_not_found", 404);
      return {
        folder: this.view(user, parent),
        resources: this.repository
          .listChildren(parent.id)
          .filter((resource) => this.repository.isVisible(user, resource))
          .map((resource) => this.view(user, resource)),
      };
    }

    if (user.workspaceRole === "owner") {
      const root = this.repository
        .listResources()
        .find(
          (resource) =>
            resource.workspaceId === user.homeWorkspaceId &&
            resource.parentId === null,
        );
      if (!root) throw new DomainError("workspace_unavailable", 503);
      return {
        folder: this.view(user, root),
        resources: this.repository
          .listChildren(root.id)
          .filter((resource) => this.repository.isVisible(user, resource))
          .map((resource) => this.view(user, resource)),
      };
    }

    const visible = this.repository
      .listResources()
      .filter((resource) => this.repository.isVisible(user, resource));
    const ids = new Set(visible.map((resource) => resource.id));
    return {
      folder: null,
      resources: visible
        .filter((resource) => !resource.parentId || !ids.has(resource.parentId))
        .map((resource) => this.view(user, resource)),
    };
  }

  details(
    user: User,
    id: string,
  ): {
    resource: ResourceView;
    breadcrumbs: ResourceView[];
    shares: ReturnType<ResourceRepository["shares"]>;
  } {
    // The direct resource seam does not enforce the
    // current access fact returned with the resource.
    const resource = this.requireResource(id);
    return {
      resource: this.view(user, resource),
      breadcrumbs: this.repository
        .breadcrumbs(resource)
        .map((item) => this.view(user, item)),
      shares: this.repository.shares(resource.id),
    };
  }

  read(
    user: User,
    id: string,
    beforeEffect?: BeforeEffect,
  ): { resource: ResourceView; bytes: Buffer } {
    const resource = this.requireResource(id);
    if (resource.kind !== "file")
      throw new DomainError("resource_not_found", 404);
    const view = this.view(user, resource);
    beforeEffect?.(view);
    return {
      resource: view,
      bytes: this.storage.read(id),
    };
  }

  createFolder(
    user: User,
    parentId: string,
    requestedName: string,
    beforeEffect?: BeforeEffect,
  ): ResourceView {
    const parent = this.requireFolder(parentId);
    const { name, nameKey } = normalizeVirtualName(requestedName);
    this.repository.assertCapacity(parent.workspaceId, 0);
    this.repository.assertNameAvailable(parent.workspaceId, parent.id, nameKey);
    beforeEffect?.(this.view(user, parent));
    return this.view(
      user,
      this.repository.insertResource({
        id: `res_${randomToken(12)}`,
        workspaceId: parent.workspaceId,
        parentId: parent.id,
        kind: "folder",
        name,
        nameKey,
        ownerId: user.id,
        mediaType: null,
        size: 0,
      }),
    );
  }

  async createFile(
    user: User,
    parentId: string,
    requestedName: string,
    input: Uint8Array,
    beforeEffect?: BeforeEffect,
  ): Promise<ResourceView> {
    const parent = this.requireFolder(parentId);
    const { name, nameKey } = normalizeVirtualName(requestedName);
    const content = await validateContent(name, input);
    this.repository.assertCapacity(
      parent.workspaceId,
      content.bytes.byteLength,
    );
    this.repository.assertNameAvailable(parent.workspaceId, parent.id, nameKey);
    beforeEffect?.(this.view(user, parent));
    const id = `res_${randomToken(12)}`;
    this.storage.writeNew(id, content.bytes);
    try {
      return this.view(
        user,
        this.repository.insertResource({
          id,
          workspaceId: parent.workspaceId,
          parentId: parent.id,
          kind: "file",
          name,
          nameKey,
          ownerId: user.id,
          mediaType: content.mediaType,
          size: content.bytes.byteLength,
        }),
      );
    } catch (error) {
      this.storage.removeNew(id);
      throw error;
    }
  }

  async replace(
    user: User,
    id: string,
    version: number,
    input: Uint8Array,
    beforeEffect?: BeforeEffect,
  ): Promise<ResourceView> {
    const resource = this.requireResource(id);
    if (resource.kind !== "file")
      throw new DomainError("resource_not_found", 404);
    this.assertVersion(resource, version);
    const content = await validateContent(resource.name, input);
    this.repository.assertCapacity(
      resource.workspaceId,
      content.bytes.byteLength,
      resource.size,
    );
    beforeEffect?.(this.view(user, resource));
    const staged = this.storage.stage([resource.id]);
    let updated: Resource;
    try {
      this.storage.writeNew(resource.id, content.bytes);
      updated = this.repository.replaceFile(
        staged,
        resource.id,
        version,
        content.mediaType,
        content.bytes.byteLength,
      );
    } catch (error) {
      this.storage.removeNew(resource.id);
      this.storage.restore(staged);
      throw error;
    }
    this.completeCleanup(staged);
    return this.view(user, updated);
  }

  share(
    user: User,
    id: string,
    version: number,
    recipientId: string,
    role: ShareRole,
    beforeEffect?: BeforeEffect,
  ): ResourceView {
    const resource = this.requireResource(id);
    this.assertVersion(resource, version);
    beforeEffect?.(this.view(user, resource));
    return this.view(
      user,
      this.repository.setShare(id, recipientId, role, version),
    );
  }

  revokeShare(
    user: User,
    id: string,
    version: number,
    recipientId: string,
    beforeEffect?: BeforeEffect,
  ): ResourceView {
    const resource = this.requireResource(id);
    this.assertVersion(resource, version);
    beforeEffect?.(this.view(user, resource));
    return this.view(
      user,
      this.repository.revokeShare(id, recipientId, version),
    );
  }

  move(
    user: User,
    id: string,
    version: number,
    destinationId: string,
    beforeEffect?: BeforeEffect,
  ): ResourceView {
    const resource = this.requireResource(id);
    const destination = this.requireFolder(destinationId);
    this.assertVersion(resource, version);
    if (destination.workspaceId !== resource.workspaceId) {
      throw new DomainError("cross_workspace_move", 400);
    }
    if (
      this.repository.descendants(id).some((item) => item.id === destinationId)
    ) {
      throw new DomainError("invalid_move", 400);
    }
    this.repository.assertNameAvailable(
      resource.workspaceId,
      destinationId,
      resource.name.toLowerCase(),
      resource.id,
    );
    beforeEffect?.(this.view(user, resource));
    return this.view(
      user,
      this.repository.moveResource(id, destinationId, version),
    );
  }

  delete(
    user: User,
    id: string,
    version: number,
    beforeEffect?: BeforeEffect,
  ): { deleted: true; count: number } {
    const resource = this.requireResource(id);
    if (resource.parentId === null)
      throw new DomainError("workspace_root_required", 400);
    const tree = this.repository.descendants(id);
    if (tree.length - 1 > limits.recursiveResources) {
      throw new DomainError("recursive_limit_exceeded", 413);
    }
    this.assertVersion(resource, version);
    beforeEffect?.(this.view(user, resource));
    const staged = this.storage.stage(
      tree.filter((item) => item.kind === "file").map((item) => item.id),
    );
    try {
      this.repository.deleteTree(staged, id, version);
    } catch (error) {
      this.storage.restore(staged);
      throw error;
    }
    this.completeCleanup(staged);
    return { deleted: true, count: tree.length };
  }

  retryCleanup(): void {
    for (const pending of this.repository.pendingDeletes()) {
      this.completeCleanup(pending);
    }
  }

  private completeCleanup(staged: StagedContent): void {
    try {
      this.storage.cleanup(staged);
      this.repository.markDeleteClean(staged.operationId);
    } catch {
      // Committed metadata stays authoritative; startup retries cleanup.
    }
  }

  private requireResource(id: string): Resource {
    parseResourceId(id);
    const resource = this.repository.getResource(id);
    if (!resource) throw new DomainError("resource_not_found", 404);
    return resource;
  }

  private requireFolder(id: string): Resource {
    const resource = this.requireResource(id);
    if (resource.kind !== "folder")
      throw new DomainError("resource_not_found", 404);
    return resource;
  }

  private assertVersion(resource: Resource, version: number): void {
    if (resource.version !== version) {
      throw new DomainError("stale_resource_version", 409);
    }
  }
}
