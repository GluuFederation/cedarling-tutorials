export type DocumentRole = "owner" | "editor" | "commenter";

export type User = Readonly<{
  id: string;
  name: string;
}>;

export type Session = Readonly<{
  user: User;
  csrfToken: string;
  expiresAt: string;
}>;

export type DocumentSummary = Readonly<{
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  role: DocumentRole | null;
  documentVersion: number;
  accessVersion: number;
  updatedAt: string;
}>;

export type DocumentMember = Readonly<{
  userId: string;
  name: string;
  role: DocumentRole;
}>;

export type DocumentComment = Readonly<{
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}>;

export type DocumentDetail = DocumentSummary &
  Readonly<{
    content: string;
    members: readonly DocumentMember[];
    comments: readonly DocumentComment[];
    candidates: readonly User[];
    actions: Readonly<{
      edit: boolean;
      comment: boolean;
      manageAccess: boolean;
    }>;
  }>;

export type DocumentCreation = Readonly<{ title: string; content: string }>;
export type DocumentUpdate = Readonly<{
  title: string;
  content: string;
  expectedDocumentVersion: number;
}>;
export type CommentCreation = Readonly<{
  body: string;
  idempotencyKey: string;
}>;
export type AccessUpdate = Readonly<{
  role: Exclude<DocumentRole, "owner">;
  expectedAccessVersion: number;
}>;
export type AccessDeletion = Readonly<{ expectedAccessVersion: number }>;

export const streamReadyEvent = "ready";

export const documentEventKinds = {
  updated: "document.updated",
  commentCreated: "comment.created",
  accessChanged: "access.changed",
} as const;

export type DocumentEvent = Readonly<{
  documentId: string;
  kind: (typeof documentEventKinds)[keyof typeof documentEventKinds];
}>;
