const messages: Readonly<Record<string, string>> = {
  authority_changed:
    "Your workspace access changed. Reload and try again. No changes were saved.",
  authorization_denied: "This action is not allowed.",
  database_unavailable: "The database is unavailable. Try again shortly.",
  authentication_required: "Your session has expired. Sign in again.",
  authorization_unavailable:
    "Authorization is unavailable right now. No changes were made.",
  billing_not_found: "Billing details are not available for this workspace.",
  idempotency_key_reused:
    "This form was already used. Reload before making another change.",
  invitation_expired:
    "That invitation has expired. Ask an admin for a new one.",
  invitation_limit_reached:
    "This workspace has reached its pending invitation limit.",
  invitation_already_pending:
    "That person already has a pending invitation. Use it or wait until it expires.",
  invitation_not_created: "The invitation could not be created. Try again.",
  invitation_not_found: "That invitation no longer exists.",
  invitation_not_pending:
    "That invitation is no longer pending. Ask an admin for a new one.",
  invitation_target_mismatch: "This invitation belongs to someone else.",
  invitation_target_not_found: "The selected teammate does not exist.",
  invitation_token_mismatch:
    "That one-time token does not match this invitation.",
  invalid_expected_version: "The workspace changed. Reload and try again.",
  invalid_idempotency_key: "The request was malformed. Reload and try again.",
  membership_already_exists: "That person is already a member.",
  membership_limit_reached: "This workspace has reached its member limit.",
  membership_not_found: "That membership no longer exists.",
  organization_not_found: "That workspace no longer exists.",
  project_not_found: "That project no longer exists.",
  request_verification_failed:
    "The request could not be verified. Reload and try again.",
  selection_not_found: "Choose a workspace to continue.",
  support_approval_invalid:
    "That support approval expired or changed. Ask for a fresh approval.",
  support_approval_not_found: "That support approval no longer exists.",
  version_conflict: "This record changed. Copy any unsaved edits, then reload.",
};

export function humanizeError(code: string): string {
  if (messages[code]) return messages[code];
  if (code.startsWith("invalid_")) {
    return "Some information was not valid. Check the form and try again.";
  }
  return "The request could not be completed. Try again.";
}

export function errorNotice(code: string, requestId: string): string {
  return `${humanizeError(code)} (ref ${requestId})`;
}
