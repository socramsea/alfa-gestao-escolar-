exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE public.users ADD CONSTRAINT users_school_identity UNIQUE(school_id,id);
    CREATE TABLE public.school_stages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      code text NOT NULL CHECK(code IN ('infantil','fundamental_initial','fundamental_final')),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,code), UNIQUE(school_id,id)
    );
    CREATE TABLE public.academic_years (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      code varchar(40) NOT NULL CHECK(length(btrim(code))>0),
      starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>starts_on),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,code), UNIQUE(school_id,id)
    );
    CREATE TABLE public.school_levels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      stage_code text NOT NULL, code varchar(40) NOT NULL CHECK(length(btrim(code))>0),
      name varchar(150) NOT NULL CHECK(length(btrim(name))>0),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,code), UNIQUE(school_id,id,stage_code),
      FOREIGN KEY(school_id,stage_code) REFERENCES public.school_stages(school_id,code)
    );
    CREATE TABLE public.school_shifts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      code varchar(40) NOT NULL CHECK(length(btrim(code))>0),
      name varchar(150) NOT NULL CHECK(length(btrim(name))>0),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,code), UNIQUE(school_id,id)
    );
    CREATE TABLE public.class_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      academic_year_id uuid NOT NULL, shift_id uuid NOT NULL, stage_code text NOT NULL,
      code varchar(40) NOT NULL CHECK(length(btrim(code))>0),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,academic_year_id,code), UNIQUE(school_id,id,stage_code),
      FOREIGN KEY(school_id,academic_year_id) REFERENCES public.academic_years(school_id,id),
      FOREIGN KEY(school_id,shift_id) REFERENCES public.school_shifts(school_id,id),
      FOREIGN KEY(school_id,stage_code) REFERENCES public.school_stages(school_id,code)
    );
    CREATE TABLE public.class_group_levels (
      school_id uuid NOT NULL REFERENCES public.schools(id), class_group_id uuid NOT NULL,
      level_id uuid NOT NULL, stage_code text NOT NULL,
      PRIMARY KEY(school_id,class_group_id,level_id),
      FOREIGN KEY(school_id,class_group_id,stage_code) REFERENCES public.class_groups(school_id,id,stage_code),
      FOREIGN KEY(school_id,level_id,stage_code) REFERENCES public.school_levels(school_id,id,stage_code)
    );
    CREATE TABLE public.structure_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL, operation text NOT NULL, request_key uuid NOT NULL,
      payload_hash text NOT NULL, entity_id uuid NOT NULL, result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(school_id,user_id) REFERENCES public.users(school_id,id),
      UNIQUE(school_id,user_id,operation,request_key)
    );
    CREATE INDEX school_levels_stage ON public.school_levels(school_id,stage_code);
    CREATE INDEX class_groups_shift ON public.class_groups(school_id,shift_id);
    CREATE INDEX class_groups_stage ON public.class_groups(school_id,stage_code);
    CREATE INDEX class_group_levels_level ON public.class_group_levels(school_id,level_id);
    CREATE INDEX structure_events_actor ON public.structure_events(school_id,user_id);
  `);
  for (const table of ['school_stages','academic_years','school_levels','school_shifts','class_groups','class_group_levels','structure_events']) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY structure_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
};
exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
