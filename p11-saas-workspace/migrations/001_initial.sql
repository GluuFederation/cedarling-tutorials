CREATE TABLE IF NOT EXISTS principals (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  issuer text NOT NULL,
  subject text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  UNIQUE (issuer, subject)
);
CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS memberships (
  principal_id text NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (principal_id, organization_id)
);

CREATE TABLE IF NOT EXISTS active_selections (
  principal_id text PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
  organization_id text REFERENCES organizations(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (octet_length(body) <= 16384),
  author_id text NOT NULL REFERENCES principals(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX IF NOT EXISTS projects_organization_idx
  ON projects (organization_id, id);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_principal_id text NOT NULL REFERENCES principals(id),
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  issuer_id text NOT NULL REFERENCES principals(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'expired', 'revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_invitation_per_target
  ON invitations (organization_id, target_principal_id)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS billing_projections (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (char_length(plan) BETWEEN 1 AND 40),
  seats integer NOT NULL CHECK (seats BETWEEN 0 AND 10000),
  monthly_cents integer NOT NULL CHECK (monthly_cents BETWEEN 0 AND 100000000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS support_approvals (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  principal_id text NOT NULL REFERENCES principals(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  operation text NOT NULL CHECK (operation = 'project.read'),
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS support_sessions (
  approval_id text PRIMARY KEY REFERENCES support_approvals(id) ON DELETE CASCADE,
  principal_id text NOT NULL REFERENCES principals(id),
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  operation text NOT NULL CHECK (operation = 'project.read'),
  approval_version integer NOT NULL CHECK (approval_version > 0),
  active_until timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS oidc_transactions (
  id_hash text PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS application_sessions (
  id_hash text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES principals(id),
  csrf_token text NOT NULL,
  encrypted_tokens text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  principal_id text NOT NULL REFERENCES principals(id),
  operation text NOT NULL,
  key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, operation, key)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
