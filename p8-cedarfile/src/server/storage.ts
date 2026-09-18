import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomToken } from "./crypto.ts";
import { parseResourceId } from "./validation.ts";

export type StagedContent = Readonly<{
  operationId: string;
  resourceIds: readonly string[];
}>;

function storageOperationId(value: string): string {
  if (!/^op_[A-Za-z0-9_-]{12,64}$/.test(value)) {
    throw new Error("storage_boundary_rejected");
  }
  return value;
}

function storageResourceId(value: string): string {
  try {
    return parseResourceId(value);
  } catch {
    throw new Error("storage_boundary_rejected");
  }
}

export class SafeStorage {
  readonly root: string;
  readonly objects: string;
  readonly quarantine: string;

  constructor(root: string) {
    const requestedRoot = path.resolve(root);
    if (existsSync(requestedRoot)) {
      const rootStat = lstatSync(requestedRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error("storage_boundary_rejected");
      }
    } else {
      mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
    }
    this.root = realpathSync(requestedRoot);
    if (this.root !== requestedRoot) {
      throw new Error("storage_boundary_rejected");
    }
    this.objects = path.join(this.root, "objects");
    this.quarantine = path.join(this.root, "quarantine");
    this.ensureDirectory(this.objects);
    this.ensureDirectory(this.quarantine);
    this.assertDirectory(this.root);
  }

  private ensureDirectory(target: string): void {
    if (!existsSync(target)) mkdirSync(target, { mode: 0o700 });
    this.assertDirectory(target);
  }

  private assertDirectory(target: string): void {
    const stat = lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("storage_boundary_rejected");
    }
    const canonical = realpathSync(target);
    if (canonical !== target) {
      throw new Error("storage_boundary_rejected");
    }
  }

  objectPath(resourceId: string): string {
    parseResourceId(resourceId);
    return path.join(this.objects, resourceId);
  }
  private operationPath(operationId: string): string {
    return path.join(this.quarantine, storageOperationId(operationId));
  }

  has(resourceId: string): boolean {
    return existsSync(this.objectPath(resourceId));
  }

  read(resourceId: string): Buffer {
    this.assertDirectory(this.objects);
    const target = this.objectPath(resourceId);
    const before = lstatSync(target);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("storage_boundary_rejected");
    }
    let handle: number;
    try {
      handle = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      // A link swap remains a boundary failure, not a host-path diagnostic.
      throw new Error("storage_boundary_rejected");
    }
    try {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("storage_boundary_rejected");
      }
      return readFileSync(handle);
    } finally {
      closeSync(handle);
    }
  }

  writeNew(resourceId: string, bytes: Uint8Array): void {
    this.assertDirectory(this.objects);
    const target = this.objectPath(resourceId);
    const handle = openSync(
      target,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(handle, bytes);
    } finally {
      closeSync(handle);
    }
  }

  removeNew(resourceId: string): void {
    this.assertDirectory(this.objects);
    const target = this.objectPath(resourceId);
    if (!existsSync(target)) return;
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("storage_boundary_rejected");
    }
    this.assertDirectory(this.objects);
    unlinkSync(target);
  }

  stage(resourceIds: readonly string[]): StagedContent {
    this.assertDirectory(this.objects);
    this.assertDirectory(this.quarantine);
    const operationId = `op_${randomToken(12)}`;
    const operationRoot = this.operationPath(operationId);
    mkdirSync(operationRoot, { mode: 0o700 });
    this.assertDirectory(operationRoot);
    const staged: string[] = [];
    try {
      for (const value of resourceIds) {
        const resourceId = storageResourceId(value);
        this.assertDirectory(this.objects);
        this.assertDirectory(this.quarantine);
        this.assertDirectory(operationRoot);
        const source = this.objectPath(resourceId);
        if (!existsSync(source)) continue;
        const stat = lstatSync(source);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error("storage_boundary_rejected");
        }
        const destination = path.join(operationRoot, resourceId);
        if (existsSync(destination)) {
          throw new Error("storage_boundary_rejected");
        }
        this.assertDirectory(this.objects);
        this.assertDirectory(operationRoot);
        renameSync(source, destination);
        staged.push(resourceId);
        this.assertDirectory(operationRoot);
        const moved = lstatSync(destination);
        if (!moved.isFile() || moved.isSymbolicLink()) {
          throw new Error("storage_boundary_rejected");
        }
      }
      return { operationId, resourceIds: staged };
    } catch (error) {
      this.restore({ operationId, resourceIds: staged });
      throw error;
    }
  }

  restore(staged: StagedContent): void {
    const operationRoot = this.operationPath(staged.operationId);
    const resourceIds = staged.resourceIds.map(storageResourceId).reverse();
    if (!existsSync(operationRoot)) return;
    this.assertDirectory(this.quarantine);
    this.assertDirectory(operationRoot);
    for (const resourceId of resourceIds) {
      const source = path.join(operationRoot, resourceId);
      if (!existsSync(source)) continue;
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("storage_boundary_rejected");
      }
      const target = this.objectPath(resourceId);
      if (existsSync(target)) throw new Error("storage_boundary_rejected");
      this.assertDirectory(this.objects);
      this.assertDirectory(operationRoot);
      renameSync(source, target);
      const restored = lstatSync(target);
      if (!restored.isFile() || restored.isSymbolicLink()) {
        throw new Error("storage_boundary_rejected");
      }
    }
    this.assertDirectory(operationRoot);
    rmdirSync(operationRoot);
  }

  cleanup(staged: StagedContent): void {
    const operationRoot = this.operationPath(staged.operationId);
    const resourceIds = staged.resourceIds.map(storageResourceId);
    if (!existsSync(operationRoot)) return;
    this.assertDirectory(this.quarantine);
    this.assertDirectory(operationRoot);
    for (const resourceId of resourceIds) {
      const target = path.join(operationRoot, resourceId);
      if (!existsSync(target)) continue;
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("storage_boundary_rejected");
      }
      this.assertDirectory(operationRoot);
      unlinkSync(target);
    }
    this.assertDirectory(operationRoot);
    rmdirSync(operationRoot);
  }
}
