ALTER TABLE idempotency_records
  ADD COLUMN request_hash text;

ALTER TABLE idempotency_records
  ALTER COLUMN request_hash SET NOT NULL;

ALTER TABLE projects
  ADD CONSTRAINT projects_id_organization_unique
  UNIQUE (id, organization_id);

ALTER TABLE support_approvals
  DROP CONSTRAINT support_approvals_project_id_fkey;

ALTER TABLE support_approvals
  ADD CONSTRAINT support_approval_project_scope_fkey
  FOREIGN KEY (project_id, organization_id)
  REFERENCES projects (id, organization_id);

ALTER TABLE support_approvals
  ADD CONSTRAINT support_approval_scope_unique
  UNIQUE (
    id,
    principal_id,
    organization_id,
    project_id,
    operation,
    version
  );

ALTER TABLE support_sessions
  ADD CONSTRAINT support_session_scope_fkey
  FOREIGN KEY (
    approval_id,
    principal_id,
    organization_id,
    project_id,
    operation,
    approval_version
  )
  REFERENCES support_approvals (
    id,
    principal_id,
    organization_id,
    project_id,
    operation,
    version
  )
  ON DELETE CASCADE;
