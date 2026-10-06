-- 0053_school_guardian_requests.sql
-- Runtime migration lives in api-server/migrate.mjs; this mirrors it for drizzle-kit parity.

CREATE TABLE IF NOT EXISTS school_guardian_requests (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  parent_user_id TEXT NOT NULL,
  student_member_id TEXT,
  normalized_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_school_guardian_requests_parent ON school_guardian_requests(parent_user_id, school_id, created_at);
CREATE INDEX IF NOT EXISTS idx_school_guardian_requests_student ON school_guardian_requests(student_member_id, status);
