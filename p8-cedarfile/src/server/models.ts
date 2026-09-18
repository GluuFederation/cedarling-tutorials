import type { OidcTokens } from "./oidc.ts";

export type User = Readonly<{
  id: string;
  issuer: string;
  subject: string;
  name: string;
  homeWorkspaceId: string;
  workspaceRole: "owner" | "guest";
}>;

export type Session = Readonly<{
  user: User;
  tokens: OidcTokens;
  csrfToken: string;
  expiresAt: number;
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
}>;

export type ShareRole = "viewer" | "editor";
