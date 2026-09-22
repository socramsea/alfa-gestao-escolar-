CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  legal_name varchar(200),
  document_number varchar(40),
  email varchar(255),
  phone varchar(40),
  status varchar(30) NOT NULL DEFAULT 'trial',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS schools_active_idx
  ON schools (id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name varchar(160) NOT NULL,
  email varchar(255) NOT NULL,
  password_hash text NOT NULL,
  role varchar(40) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_school_email_unique_idx
  ON users (school_id, lower(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_school_active_idx
  ON users (school_id, active)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES schools(id),
  user_id uuid REFERENCES users(id),
  action varchar(80) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_school_created_idx
  ON audit_logs (school_id, created_at DESC);
