exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE public.staff_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      full_name varchar(150) NOT NULL CHECK(length(btrim(full_name))>0),
      phone varchar(30) CHECK(phone IS NULL OR length(btrim(phone))>0),
      email varchar(150) CHECK(email IS NULL OR length(btrim(email))>0),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id)
    );
    CREATE TABLE public.class_group_staff (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      staff_member_id uuid NOT NULL, academic_year_id uuid NOT NULL, class_group_id uuid NOT NULL,
      role text NOT NULL CHECK(role IN ('regente','auxiliar','especialista')),
      starts_on date NOT NULL, ends_on date CHECK(ends_on IS NULL OR ends_on>=starts_on),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id),
      FOREIGN KEY(school_id,staff_member_id) REFERENCES public.staff_members(school_id,id),
      FOREIGN KEY(school_id,academic_year_id) REFERENCES public.academic_years(school_id,id),
      FOREIGN KEY(school_id,academic_year_id,class_group_id)
        REFERENCES public.class_groups(school_id,academic_year_id,id)
    );
    CREATE TABLE public.class_group_staff_endings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      assignment_id uuid NOT NULL, ended_on date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id), UNIQUE(school_id,assignment_id),
      FOREIGN KEY(school_id,assignment_id) REFERENCES public.class_group_staff(school_id,id)
    );
    CREATE TABLE public.staff_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL,
      operation text NOT NULL CHECK(operation IN ('members','assignments','assignment-endings')),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(school_id,user_id) REFERENCES public.users(school_id,id),
      UNIQUE(school_id,user_id,operation,request_key)
    );
    CREATE INDEX staff_members_listing ON public.staff_members(school_id,created_at,id);
    CREATE INDEX class_group_staff_listing ON public.class_group_staff(school_id,created_at,id);
    CREATE INDEX class_group_staff_member ON public.class_group_staff(school_id,staff_member_id,class_group_id);
    CREATE INDEX class_group_staff_group ON public.class_group_staff(school_id,class_group_id);
    CREATE INDEX class_group_staff_endings_listing ON public.class_group_staff_endings(school_id,created_at,id);
    CREATE INDEX staff_events_actor ON public.staff_events(school_id,user_id);
  `);
  for (const table of ['staff_members','class_group_staff','class_group_staff_endings','staff_events']) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY staff_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
};
exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
