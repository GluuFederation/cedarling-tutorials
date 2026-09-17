TRUNCATE idempotency_records, application_sessions, oidc_transactions,
  support_sessions, support_approvals, invitations, billing_projections,
  projects, active_selections, memberships, organizations, principals CASCADE;

INSERT INTO principals (id, issuer, subject, name) VALUES
  ('user-maya', 'http://idp.localhost:4000', 'maya', 'Maya'),
  ('user-noah', 'http://idp.localhost:4000', 'noah', 'Noah'),
  ('user-lena', 'http://idp.localhost:4000', 'lena', 'Lena'),
  ('user-imani', 'http://idp.localhost:4000', 'imani', 'Imani');

INSERT INTO organizations (id, name) VALUES
  ('aster', 'Tenant A · Aster'),
  ('boreal', 'Tenant B · Boreal');

INSERT INTO memberships (principal_id, organization_id, role) VALUES
  ('user-maya', 'aster', 'admin'),
  ('user-maya', 'boreal', 'viewer'),
  ('user-noah', 'aster', 'editor');

INSERT INTO active_selections (principal_id, organization_id, version) VALUES
  ('user-maya', 'aster', 1),
  ('user-noah', 'aster', 1),
  ('user-lena', NULL, 1),
  ('user-imani', NULL, 1);

INSERT INTO projects (id, organization_id, name, body, author_id) VALUES
  ('project-a1', 'aster', 'Aster checkout hardening', 'Track the Tenant A checkout reliability plan.', 'user-noah'),
  ('project-a2', 'aster', 'Aster financial controls', 'Private Tenant A finance control notes.', 'user-maya'),
  ('project-b1', 'boreal', 'Boreal launch readiness', 'Tenant B launch checklist and milestones.', 'user-maya');

INSERT INTO billing_projections
  (organization_id, plan, seats, monthly_cents) VALUES
  ('aster', 'Enterprise', 18, 360000),
  ('boreal', 'Team', 7, 98000);

INSERT INTO invitations
  (id, organization_id, target_principal_id, role, issuer_id, token_hash, expires_at, state)
VALUES
  ('invite-lena-aster', 'aster', 'user-lena', 'viewer', 'user-maya',
   'BRc1ep9tjr_5t2zoxYPpUjxKepB8OcZa3fjw3zZjwMc', now() + interval '15 minutes', 'pending');

INSERT INTO support_approvals
  (id, principal_id, organization_id, project_id, operation, expires_at)
VALUES
  ('support-imani-a1', 'user-imani', 'aster', 'project-a1', 'project.read', now() + interval '2 hours');
