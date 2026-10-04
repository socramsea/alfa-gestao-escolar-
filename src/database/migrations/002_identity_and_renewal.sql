-- Identidade, cadastro escolar e renovação de matrícula.
--
-- Isolamento no banco: toda tabela de escola possui school_id e as relações usam
-- chaves estrangeiras compostas (id, school_id). Assim o próprio PostgreSQL impede
-- que um registro de uma escola aponte para um registro de outra.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Escolas ------------------------------------------------------------------

ALTER TABLE schools ADD COLUMN IF NOT EXISTS slug varchar(60);
CREATE UNIQUE INDEX IF NOT EXISTS schools_slug_unique_idx ON schools (slug);
ALTER TABLE schools
  ADD CONSTRAINT schools_status_check CHECK (status IN ('trial', 'active', 'suspended'));

CREATE TRIGGER schools_set_updated_at BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Usuários da equipe escolar ----------------------------------------------

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (
    role IN ('school_admin', 'director', 'secretary', 'finance', 'coordinator', 'teacher')
  );
ALTER TABLE users ADD CONSTRAINT users_id_school_unique UNIQUE (id, school_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auditoria ----------------------------------------------------------------

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type varchar(20) NOT NULL DEFAULT 'user';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('user', 'guardian', 'system'));
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (school_id, entity_type, entity_id);

-- Anos letivos e turmas ----------------------------------------------------

CREATE TABLE school_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  starts_on date,
  ends_on date,
  status varchar(20) NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, year)
);

CREATE TRIGGER school_years_set_updated_at BEFORE UPDATE ON school_years
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  school_year_id uuid NOT NULL,
  name varchar(80) NOT NULL,
  grade varchar(60) NOT NULL,
  shift varchar(20) NOT NULL CHECK (shift IN ('morning', 'afternoon', 'evening', 'full_time')),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, school_id),
  FOREIGN KEY (school_year_id, school_id) REFERENCES school_years (id, school_id)
);

CREATE UNIQUE INDEX classes_year_name_unique_idx
  ON classes (school_year_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE TRIGGER classes_set_updated_at BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Alunos e responsáveis ----------------------------------------------------

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  full_name varchar(160) NOT NULL,
  social_name varchar(160),
  birth_date date NOT NULL,
  cpf varchar(11),
  current_class_id uuid,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_notes text,
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'transferred', 'graduated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, school_id),
  FOREIGN KEY (current_class_id, school_id) REFERENCES classes (id, school_id)
);

CREATE INDEX students_school_name_idx ON students (school_id, lower(full_name)) WHERE deleted_at IS NULL;
CREATE INDEX students_school_class_idx ON students (school_id, current_class_id) WHERE deleted_at IS NULL;

CREATE TRIGGER students_set_updated_at BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  full_name varchar(160) NOT NULL,
  cpf varchar(11),
  phone varchar(13),
  email varchar(255),
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, school_id)
);

CREATE INDEX guardians_school_name_idx ON guardians (school_id, lower(full_name)) WHERE deleted_at IS NULL;

CREATE TRIGGER guardians_set_updated_at BEFORE UPDATE ON guardians
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE student_guardians (
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  relationship varchar(40) NOT NULL,
  is_financial_responsible boolean NOT NULL DEFAULT false,
  is_primary_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, guardian_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id),
  FOREIGN KEY (guardian_id, school_id) REFERENCES guardians (id, school_id)
);

CREATE INDEX student_guardians_guardian_idx ON student_guardians (guardian_id);

-- Links de acesso do responsável ------------------------------------------
-- O token em si nunca é armazenado: apenas o hash SHA-256.

CREATE TABLE guardian_access_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  guardian_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guardian_id, school_id) REFERENCES guardians (id, school_id),
  FOREIGN KEY (created_by, school_id) REFERENCES users (id, school_id)
);

CREATE INDEX guardian_access_links_guardian_idx ON guardian_access_links (guardian_id);

-- Matrículas ---------------------------------------------------------------

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL,
  school_year_id uuid NOT NULL,
  class_id uuid,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
  source_renewal_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (student_id, school_year_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id),
  FOREIGN KEY (school_year_id, school_id) REFERENCES school_years (id, school_id),
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id)
);

CREATE TRIGGER enrollments_set_updated_at BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Renovação de matrícula ---------------------------------------------------

CREATE TABLE renewal_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  school_year_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  CHECK (ends_on >= starts_on),
  FOREIGN KEY (school_year_id, school_id) REFERENCES school_years (id, school_id),
  FOREIGN KEY (created_by, school_id) REFERENCES users (id, school_id)
);

CREATE TRIGGER renewal_campaigns_set_updated_at BEFORE UPDATE ON renewal_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE renewal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  campaign_id uuid NOT NULL,
  student_id uuid NOT NULL,
  target_class_id uuid,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'changes_requested', 'approved', 'rejected')),
  submitted_by_guardian_id uuid,
  proposed_data jsonb,
  guardian_notes text,
  terms_accepted_at timestamptz,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (campaign_id, student_id),
  FOREIGN KEY (campaign_id, school_id) REFERENCES renewal_campaigns (id, school_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id),
  FOREIGN KEY (target_class_id, school_id) REFERENCES classes (id, school_id),
  FOREIGN KEY (submitted_by_guardian_id, school_id) REFERENCES guardians (id, school_id),
  FOREIGN KEY (reviewed_by, school_id) REFERENCES users (id, school_id)
);

CREATE INDEX renewal_requests_campaign_status_idx ON renewal_requests (school_id, campaign_id, status);

CREATE TRIGGER renewal_requests_set_updated_at BEFORE UPDATE ON renewal_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE enrollments
  ADD FOREIGN KEY (source_renewal_request_id, school_id) REFERENCES renewal_requests (id, school_id);

CREATE TABLE renewal_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  request_id uuid NOT NULL,
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  actor_type varchar(20) NOT NULL CHECK (actor_type IN ('user', 'guardian', 'system')),
  actor_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (request_id, school_id) REFERENCES renewal_requests (id, school_id)
);

CREATE INDEX renewal_request_events_request_idx ON renewal_request_events (request_id, created_at);
