// Entrega 9: notas e avaliações. Tudo só de inserção: corrigir uma nota grava uma linha nova que aponta para a anterior.
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE public.assessment_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      code varchar(20) NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,20}$'),
      name varchar(80) NOT NULL CHECK(length(btrim(name))>0),
      default_weight numeric(5,2) NOT NULL CHECK(default_weight>0 AND default_weight<=100),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id), UNIQUE(school_id,code)
    );
    CREATE TABLE public.assessments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      academic_year_id uuid NOT NULL, class_group_id uuid NOT NULL, assessment_type_id uuid NOT NULL,
      title varchar(120) NOT NULL CHECK(length(btrim(title))>0),
      held_on date NOT NULL,
      weight numeric(5,2) NOT NULL CHECK(weight>0 AND weight<=100),
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id),
      FOREIGN KEY(school_id,academic_year_id,class_group_id)
        REFERENCES public.class_groups(school_id,academic_year_id,id),
      FOREIGN KEY(school_id,assessment_type_id) REFERENCES public.assessment_types(school_id,id),
      FOREIGN KEY(school_id,created_by) REFERENCES public.users(school_id,id)
    );
    -- Escala fixa de 0 a 10. A nota original tem corrects_id nulo; a correção aponta para a nota que substitui,
    -- do mesmo aluno na mesma avaliação, e exige o motivo.
    CREATE TABLE public.student_assessments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      assessment_id uuid NOT NULL, student_id uuid NOT NULL,
      score numeric(4,2) NOT NULL CHECK(score>=0 AND score<=10),
      corrects_id uuid CHECK(corrects_id IS DISTINCT FROM id),
      reason varchar(300) CHECK(reason IS NULL OR length(btrim(reason))>0),
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK((corrects_id IS NULL)=(reason IS NULL)),
      UNIQUE(school_id,id), UNIQUE(school_id,assessment_id,student_id,id),
      FOREIGN KEY(school_id,assessment_id) REFERENCES public.assessments(school_id,id),
      FOREIGN KEY(school_id,student_id) REFERENCES public.students(school_id,id),
      FOREIGN KEY(school_id,assessment_id,student_id,corrects_id)
        REFERENCES public.student_assessments(school_id,assessment_id,student_id,id),
      FOREIGN KEY(school_id,created_by) REFERENCES public.users(school_id,id)
    );
    -- Uma nota original por aluno e avaliação, e cada nota corrigida no máximo uma vez: o histórico é uma fila única.
    CREATE UNIQUE INDEX student_assessments_original ON public.student_assessments(school_id,assessment_id,student_id)
      WHERE corrects_id IS NULL;
    CREATE UNIQUE INDEX student_assessments_single_correction ON public.student_assessments(school_id,corrects_id)
      WHERE corrects_id IS NOT NULL;
    CREATE TABLE public.assessment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL,
      operation text NOT NULL CHECK(operation IN ('types','assessments','scores')),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL, result jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(school_id,user_id) REFERENCES public.users(school_id,id),
      UNIQUE(school_id,user_id,operation,request_key)
    );
    -- Canal interno de eventos (outbox): gravado na mesma transação do fato, para módulos futuros consumirem.
    -- Guarda só identificadores; quem consumir busca o restante com as próprias permissões.
    CREATE TABLE public.outbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      topic text NOT NULL CHECK(topic IN ('nota_lancada')),
      entity_id uuid NOT NULL, payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,id)
    );
    CREATE INDEX assessment_types_listing ON public.assessment_types(school_id,created_at,id);
    CREATE INDEX assessments_class_group ON public.assessments(school_id,class_group_id,held_on,created_at);
    CREATE INDEX student_assessments_assessment ON public.student_assessments(school_id,assessment_id,student_id,created_at);
    CREATE INDEX assessment_events_actor ON public.assessment_events(school_id,user_id);
    CREATE INDEX outbox_events_topic ON public.outbox_events(school_id,topic,created_at,id);
  `);
  for (const table of ['assessment_types','assessments','student_assessments','assessment_events','outbox_events']) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY assessment_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
};
exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
