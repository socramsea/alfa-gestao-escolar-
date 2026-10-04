exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE public.class_groups
      ADD CONSTRAINT class_groups_school_year_id UNIQUE(school_id,academic_year_id,id);
    CREATE TABLE public.enrollments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      student_id uuid NOT NULL, academic_year_id uuid NOT NULL,
      class_group_id uuid NOT NULL, level_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id), UNIQUE(school_id,student_id,academic_year_id),
      FOREIGN KEY(school_id,student_id) REFERENCES public.students(school_id,id),
      FOREIGN KEY(school_id,academic_year_id) REFERENCES public.academic_years(school_id,id),
      FOREIGN KEY(school_id,academic_year_id,class_group_id)
        REFERENCES public.class_groups(school_id,academic_year_id,id),
      FOREIGN KEY(school_id,class_group_id,level_id)
        REFERENCES public.class_group_levels(school_id,class_group_id,level_id)
    );
    CREATE TABLE public.enrollment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL, operation text NOT NULL CHECK(operation='enrollments'),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(school_id,user_id) REFERENCES public.users(school_id,id),
      FOREIGN KEY(school_id,entity_id) REFERENCES public.enrollments(school_id,id),
      UNIQUE(school_id,user_id,operation,request_key)
    );
    CREATE INDEX enrollments_listing ON public.enrollments(school_id,created_at,id);
    CREATE INDEX enrollments_class_group ON public.enrollments(school_id,class_group_id,level_id);
    CREATE INDEX enrollment_events_actor ON public.enrollment_events(school_id,user_id);
  `);
  for (const table of ['enrollments','enrollment_events']) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY enrollment_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
};
exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
