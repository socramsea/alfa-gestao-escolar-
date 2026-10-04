exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE public.students (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      full_name varchar(150) NOT NULL CHECK(length(btrim(full_name))>0),
      birth_date date NOT NULL CHECK(birth_date >= DATE '1900-01-01' AND birth_date <= CURRENT_DATE),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id)
    );
    CREATE TABLE public.guardians (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      full_name varchar(150) NOT NULL CHECK(length(btrim(full_name))>0),
      phone varchar(30) CHECK(phone IS NULL OR length(btrim(phone))>0),
      email varchar(150) CHECK(email IS NULL OR length(btrim(email))>0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id)
    );
    CREATE TABLE public.student_guardians (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      student_id uuid NOT NULL, guardian_id uuid NOT NULL,
      relationship varchar(80) NOT NULL CHECK(length(btrim(relationship))>0),
      is_legal boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id), UNIQUE(school_id,student_id,guardian_id),
      FOREIGN KEY(school_id,student_id) REFERENCES public.students(school_id,id),
      FOREIGN KEY(school_id,guardian_id) REFERENCES public.guardians(school_id,id)
    );
    CREATE TABLE public.people_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id), user_id uuid NOT NULL,
      operation text NOT NULL CHECK(operation IN ('students','guardians','student-guardians')),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(school_id,user_id) REFERENCES public.users(school_id,id),
      UNIQUE(school_id,user_id,operation,request_key)
    );
    CREATE INDEX students_listing ON public.students(school_id,created_at,id);
    CREATE INDEX guardians_listing ON public.guardians(school_id,created_at,id);
    CREATE INDEX student_guardians_listing ON public.student_guardians(school_id,created_at,id);
    CREATE INDEX student_guardians_guardian ON public.student_guardians(school_id,guardian_id);
    CREATE INDEX people_events_actor ON public.people_events(school_id,user_id);
  `);
  for (const table of ['students','guardians','student_guardians','people_events']) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY people_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
};
exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
