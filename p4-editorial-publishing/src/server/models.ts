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

/** Authority row and version used for both the decision and its write guard. */
export type Authority = {
  principalId: string;
  tenantId: string;
  role: "editor" | "publisher";
  current: boolean;
  version: number | null;
};

/** Immutable review binding plus the reviewer's current authority snapshot. */
export type Approval = {
  id: string;
  revisionId: string;
  revisionVersion: number;
  digest: string;
  reviewerId: string;
  authorityCurrent: boolean;
  authorityVersion: number | null;
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
