/** Bounded failures shared by authorization and the protected effect boundaries. */
export class AuthorizationError extends Error {
  readonly status: 403 | 409 | 503;
  readonly code:
    | "authorization_denied"
    | "authorization_state_changed"
    | "authorization_unavailable";

  constructor(
    status: AuthorizationError["status"],
    code: AuthorizationError["code"],
  ) {
    super(code);
    this.name = "AuthorizationError";
    this.status = status;
    this.code = code;
  }
}
