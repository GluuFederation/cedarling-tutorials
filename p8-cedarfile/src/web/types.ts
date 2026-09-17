export type Session = Readonly<{
  user: {
    id: string;
    name: string;
    workspaceId: string;
    role: "owner" | "guest";
  };
  csrfToken: string;
  expiresAt: string;
}>;

export type Resource = Readonly<{
  id: string;
  workspaceId: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  ownerId: string;
  mediaType: string | null;
  size: number;
  version: number;
  updatedAt: string;
  access: "owner" | "editor" | "viewer" | "none";
}>;

export type ResourceDetails = Readonly<{
  resource: Resource;
  breadcrumbs: Resource[];
  shares: Array<{
    userId: string;
    name: string;
    role: "viewer" | "editor";
  }>;
}>;
