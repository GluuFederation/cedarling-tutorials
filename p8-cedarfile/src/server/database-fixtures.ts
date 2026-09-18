import type Database from "better-sqlite3";
import type { SafeStorage } from "./storage.ts";

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  home_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  workspace_role TEXT NOT NULL CHECK (workspace_role IN ('owner', 'guest')),
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES resources(id),
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  media_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'folder' AND media_type IS NULL AND size = 0) OR kind = 'file')
);
CREATE UNIQUE INDEX IF NOT EXISTS resource_sibling_name
  ON resources(workspace_id, parent_id, name_key);
CREATE TABLE IF NOT EXISTS shares (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  PRIMARY KEY (resource_id, user_id)
);
CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  encrypted_tokens TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS delete_operations (
  id TEXT PRIMARY KEY,
  resource_ids TEXT NOT NULL,
  cleanup_pending INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

const seededAt = "2026-08-29T00:00:00.000Z";
const seedResources = [
  {
    id: "res_01K3ROOTAAAA",
    workspace: "workspace-a",
    parent: null,
    kind: "folder",
    name: "Workspace A",
    owner: "user-jordan",
    media: null,
    size: 0,
  },
  {
    id: "res_01K3SHAREAAA",
    workspace: "workspace-a",
    parent: "res_01K3ROOTAAAA",
    kind: "folder",
    name: "Launch assets",
    owner: "user-jordan",
    media: null,
    size: 0,
  },
  {
    id: "res_01K3NOTESAAA",
    workspace: "workspace-a",
    parent: "res_01K3SHAREAAA",
    kind: "file",
    name: "launch-notes.md",
    owner: "user-jordan",
    media: "text/markdown",
    size: 63,
  },
  {
    id: "res_01K3VIEWAAAA",
    workspace: "workspace-a",
    parent: "res_01K3ROOTAAAA",
    kind: "file",
    name: "shared-overview.txt",
    owner: "user-jordan",
    media: "text/plain",
    size: 49,
  },
  {
    id: "res_01K3PRIVATEA",
    workspace: "workspace-a",
    parent: "res_01K3ROOTAAAA",
    kind: "file",
    name: "private-plan.txt",
    owner: "user-jordan",
    media: "text/plain",
    size: 55,
  },
  {
    id: "res_01K3ROOTBBBB",
    workspace: "workspace-b",
    parent: null,
    kind: "folder",
    name: "Workspace B",
    owner: "user-lee",
    media: null,
    size: 0,
  },
  {
    id: "res_01K3PRIVATEB",
    workspace: "workspace-b",
    parent: "res_01K3ROOTBBBB",
    kind: "file",
    name: "workspace-b-private.txt",
    owner: "user-lee",
    media: "text/plain",
    size: 51,
  },
] as const;

const seedContent = new Map<string, Buffer>([
  [
    "res_01K3NOTESAAA",
    Buffer.from(
      "# Launch notes\n\nCurated assets for the CedarFile tutorial.\n",
      "utf8",
    ),
  ],
  [
    "res_01K3VIEWAAAA",
    Buffer.from("This file is shared with Lee as a viewer.\n", "utf8"),
  ],
  [
    "res_01K3PRIVATEA",
    Buffer.from("This sibling is private inside Workspace A.\n", "utf8"),
  ],
  [
    "res_01K3PRIVATEB",
    Buffer.from("This resource belongs to a different workspace.\n", "utf8"),
  ],
]);

export function initializeDatabase(
  database: Database.Database,
  issuer: string,
  storage?: SafeStorage,
): void {
  database.exec(schema);
  database.transaction(() => {
    database
      .prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)")
      .run("workspace-a", "Workspace A");
    database
      .prepare("INSERT OR IGNORE INTO workspaces (id, name) VALUES (?, ?)")
      .run("workspace-b", "Workspace B");
    const user = database.prepare(`INSERT OR IGNORE INTO users
      (id, issuer, subject, name, home_workspace_id, workspace_role)
      VALUES (?, ?, ?, ?, ?, ?)`);
    user.run("user-jordan", issuer, "jordan", "Jordan", "workspace-a", "owner");
    user.run("user-priya", issuer, "priya", "Priya", "workspace-a", "guest");
    user.run("user-lee", issuer, "lee", "Lee", "workspace-b", "guest");

    const resource = database.prepare(`INSERT OR IGNORE INTO resources
      (id, workspace_id, parent_id, kind, name, name_key, owner_id, media_type, size, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);
    for (const item of seedResources) {
      resource.run(
        item.id,
        item.workspace,
        item.parent,
        item.kind,
        item.name,
        item.name.normalize("NFC").toLowerCase(),
        item.owner,
        item.media,
        seedContent.get(item.id)?.byteLength ?? item.size,
        seededAt,
      );
    }
    database
      .prepare(
        "INSERT OR IGNORE INTO shares (resource_id, user_id, role) VALUES (?, ?, ?)",
      )
      .run("res_01K3SHAREAAA", "user-priya", "editor");
    database
      .prepare(
        "INSERT OR IGNORE INTO shares (resource_id, user_id, role) VALUES (?, ?, ?)",
      )
      .run("res_01K3VIEWAAAA", "user-lee", "viewer");
  })();

  if (storage) {
    for (const [id, bytes] of seedContent) {
      if (!storage.has(id)) storage.writeNew(id, bytes);
    }
  }
}
