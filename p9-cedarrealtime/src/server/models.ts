import type { OidcTokens } from "./oidc.ts";

export type User = Readonly<{
  id: string;
  issuer: string;
  subject: string;
  name: string;
  tenantId: string;
}>;

export type Room = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  version: number;
  nextSequence: number;
}>;

export type Membership = Readonly<{
  roomId: string;
  userId: string;
  role: "member" | "moderator";
  active: boolean;
  version: number;
  revokedAt?: number;
}>;

export type Message = Readonly<{
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  content: string | null;
  sequence: number;
  version: number;
  deleted: boolean;
  createdAt: number;
}>;

export type Session = Readonly<{
  idHash: string;
  user: User;
  tokens: OidcTokens;
  csrfToken: string;
  expiresAt: number;
}>;
