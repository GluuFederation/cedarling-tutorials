export type RevisionState =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "published";

export type Principal = {
  id: string;
  issuer: string;
  subject: string;
  name: string;
  tenantId: string;
};

export type Session = {
  csrfToken: string;
  principal: Principal;
};

export type OidcTokens = {
  issuer: string;
  subject: string;
  accessToken: string;
  idToken: string;
  accessTokenExpiresAt: number;
  idTokenExpiresAt: number;
};

export type ArticleSummary = {
  id: string;
  title: string;
  state: RevisionState;
  version: number;
};

export type RevisionView = {
  id: string;
  version: number;
  title: string;
  body: string;
  digest: string;
  authorId: string;
  authorName: string;
  state: RevisionState;
};

export type ReviewView = {
  reviewerName: string;
  decision: "approved" | "rejected";
  authorityCurrent: boolean;
};

export type ArticleView = {
  id: string;
  tenantId: string;
  version: number;
  currentRevisionId: string;
  revision: RevisionView;
  revisions: Array<Pick<RevisionView, "id" | "version" | "state">>;
  review?: ReviewView;
  published: boolean;
};

export type OidcTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
};
