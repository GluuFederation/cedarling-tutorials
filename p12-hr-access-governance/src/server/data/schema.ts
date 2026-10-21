export const SCHEMA_VERSION = 2;
export const schema = `
CREATE TABLE principals (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, tenantId TEXT NOT NULL, role TEXT NOT NULL,
 administrator INTEGER NOT NULL, reviewer INTEGER NOT NULL, clinician INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE employees (
 id TEXT PRIMARY KEY, employeeNumber TEXT NOT NULL UNIQUE, name TEXT NOT NULL, preferredName TEXT NOT NULL,
 tenantId TEXT NOT NULL, managerId TEXT NOT NULL REFERENCES principals(id),
 team TEXT NOT NULL, jobTitle TEXT NOT NULL, office TEXT NOT NULL,
 employmentType TEXT NOT NULL, employmentStatus TEXT NOT NULL CHECK(employmentStatus IN ('Active','On leave')),
 startDate TEXT NOT NULL, workEmail TEXT NOT NULL, workPhone TEXT NOT NULL,
 personalEmail TEXT NOT NULL, mobilePhone TEXT NOT NULL, address TEXT NOT NULL,
 emergencyName TEXT NOT NULL, emergencyRelationship TEXT NOT NULL, emergencyPhone TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE medical_records (
 employeeId TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
 value TEXT NOT NULL CHECK(json_valid(value)), version INTEGER NOT NULL CHECK(version > 0)
);
CREATE TABLE packages (id TEXT PRIMARY KEY, scope TEXT NOT NULL, fieldGroup TEXT NOT NULL);
CREATE TABLE grants (
 id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, packageId TEXT NOT NULL REFERENCES packages(id),
 employeeId TEXT NOT NULL REFERENCES employees(id), requesterId TEXT NOT NULL REFERENCES principals(id),
 beneficiaryId TEXT NOT NULL REFERENCES principals(id), scope TEXT NOT NULL, reason TEXT NOT NULL,
 durationDays INTEGER NOT NULL CHECK(durationDays BETWEEN 1 AND 7),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked','expired')),
 createdAt INTEGER NOT NULL, reviewDeadline INTEGER NOT NULL,
 approvedAt INTEGER, expiresAt INTEGER, reviewedBy TEXT REFERENCES principals(id), reviewedAt INTEGER,
 reviewNote TEXT, revokedBy TEXT REFERENCES principals(id), revokedAt INTEGER,
 version INTEGER NOT NULL CHECK(version > 0),
 CHECK((approvedAt IS NULL AND expiresAt IS NULL) OR (approvedAt IS NOT NULL AND expiresAt > approvedAt)),
 CHECK(reviewDeadline > createdAt)
);
CREATE UNIQUE INDEX active_grant ON grants(packageId,employeeId,beneficiaryId) WHERE status IN ('pending','approved');
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, principalId TEXT NOT NULL REFERENCES principals(id), csrfToken TEXT NOT NULL, expiresAt INTEGER NOT NULL
);
CREATE TABLE login_transactions (id TEXT PRIMARY KEY,value TEXT NOT NULL,expiresAt INTEGER NOT NULL);
`;
