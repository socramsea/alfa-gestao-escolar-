-- Unidades, site público da escola e captação de novos alunos (pré-matrícula).

-- Unidades -----------------------------------------------------------------

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  name varchar(120) NOT NULL,
  slug varchar(60) NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  phone varchar(13),
  whatsapp varchar(13),
  opening_hours varchar(160),
  accepting_enrollments boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, slug)
);

CREATE TRIGGER units_set_updated_at BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Toda escola existente ganha a unidade sede, e os dados atuais passam a pertencer a ela.
INSERT INTO units (school_id, name, slug)
SELECT id, 'Unidade Sede', 'sede' FROM schools;

ALTER TABLE classes ADD COLUMN unit_id uuid;
ALTER TABLE classes ADD FOREIGN KEY (unit_id, school_id) REFERENCES units (id, school_id);
UPDATE classes c SET unit_id = u.id FROM units u WHERE u.school_id = c.school_id AND u.slug = 'sede';

ALTER TABLE students ADD COLUMN unit_id uuid;
ALTER TABLE students ADD FOREIGN KEY (unit_id, school_id) REFERENCES units (id, school_id);
UPDATE students s SET unit_id = u.id FROM units u WHERE u.school_id = s.school_id AND u.slug = 'sede';
CREATE INDEX students_school_unit_idx ON students (school_id, unit_id) WHERE deleted_at IS NULL;

-- Campanhas passam a ter tipo: renovação (alunos atuais) ou matrícula de novos alunos.
ALTER TABLE renewal_campaigns ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'renewal'
  CHECK (kind IN ('renewal', 'admission'));
ALTER TABLE renewal_campaigns ADD COLUMN unit_id uuid;
ALTER TABLE renewal_campaigns ADD FOREIGN KEY (unit_id, school_id) REFERENCES units (id, school_id);

-- Site público -------------------------------------------------------------

CREATE TABLE school_sites (
  school_id uuid PRIMARY KEY REFERENCES schools(id),
  published boolean NOT NULL DEFAULT false,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (updated_by, school_id) REFERENCES users (id, school_id)
);

CREATE TRIGGER school_sites_set_updated_at BEFORE UPDATE ON school_sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Imagens públicas do site (fotos de uniforme, fachada). Não guardar documentos aqui.
CREATE TABLE site_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  content_type varchar(40) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  data bytea NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (created_by, school_id) REFERENCES users (id, school_id)
);

CREATE INDEX site_assets_school_idx ON site_assets (school_id);

-- Captação: interessados, visitas e histórico ------------------------------

CREATE TABLE admission_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  unit_id uuid NOT NULL,
  code varchar(12) NOT NULL,
  guardian_name varchar(160) NOT NULL,
  guardian_phone varchar(13) NOT NULL,
  guardian_email varchar(255),
  student_name varchar(160) NOT NULL,
  student_birth_date date,
  desired_grade varchar(60),
  desired_year integer,
  interest varchar(20) NOT NULL DEFAULT 'visit' CHECK (interest IN ('visit', 'enroll', 'info')),
  source varchar(20) NOT NULL DEFAULT 'site'
    CHECK (source IN ('site', 'whatsapp', 'referral', 'instagram', 'walk_in', 'other')),
  how_heard varchar(120),
  message text,
  status varchar(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'visit_scheduled', 'visited', 'enrolling', 'enrolled', 'lost')),
  lost_reason varchar(200),
  consent_at timestamptz NOT NULL,
  student_id uuid,
  guardian_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (school_id, code),
  FOREIGN KEY (unit_id, school_id) REFERENCES units (id, school_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id),
  FOREIGN KEY (guardian_id, school_id) REFERENCES guardians (id, school_id)
);

CREATE INDEX admission_leads_status_idx ON admission_leads (school_id, status, created_at DESC);

CREATE TRIGGER admission_leads_set_updated_at BEFORE UPDATE ON admission_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admission_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  lead_id uuid NOT NULL,
  type varchar(30) NOT NULL,
  from_status varchar(20),
  to_status varchar(20),
  notes text,
  actor_type varchar(20) NOT NULL CHECK (actor_type IN ('user', 'guardian', 'system', 'public')),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (lead_id, school_id) REFERENCES admission_leads (id, school_id)
);

CREATE INDEX admission_lead_events_lead_idx ON admission_lead_events (lead_id, created_at);

CREATE TABLE visit_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  unit_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  capacity integer NOT NULL DEFAULT 3 CHECK (capacity BETWEEN 1 AND 50),
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  UNIQUE (unit_id, starts_at),
  FOREIGN KEY (unit_id, school_id) REFERENCES units (id, school_id),
  FOREIGN KEY (created_by, school_id) REFERENCES users (id, school_id)
);

CREATE TABLE visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  slot_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'attended', 'no_show', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (slot_id, school_id) REFERENCES visit_slots (id, school_id),
  FOREIGN KEY (lead_id, school_id) REFERENCES admission_leads (id, school_id)
);

CREATE INDEX visits_slot_idx ON visits (slot_id) WHERE status = 'scheduled';
CREATE UNIQUE INDEX visits_one_active_per_lead_idx ON visits (lead_id) WHERE status = 'scheduled';

CREATE TRIGGER visits_set_updated_at BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A solicitação de matrícula de um aluno novo aponta para o interessado de origem.
ALTER TABLE renewal_requests ADD COLUMN admission_lead_id uuid;
ALTER TABLE renewal_requests ADD FOREIGN KEY (admission_lead_id, school_id) REFERENCES admission_leads (id, school_id);

-- Aluno novo ainda em processo de matrícula: não conta como ativo nem entra em renovações.
ALTER TABLE students DROP CONSTRAINT students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('applicant', 'active', 'inactive', 'transferred', 'graduated'));
