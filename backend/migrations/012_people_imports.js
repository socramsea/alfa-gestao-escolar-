// Importação de planilha de alunos e responsáveis. Cada importação confirmada fica registrada
// com autor, chave de reenvio e resultado por referência (linhas, situações e ids, sem dados pessoais).
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE public.people_imports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL,
      request_key uuid NOT NULL,
      payload_hash text NOT NULL,
      result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id, id), UNIQUE (school_id, user_id, request_key),
      FOREIGN KEY (school_id, user_id) REFERENCES public.users(school_id, id)
    );
    CREATE INDEX people_imports_listing ON public.people_imports(school_id, created_at DESC, id DESC);

    ALTER TABLE public.people_imports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.people_imports FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON public.people_imports FROM PUBLIC, alfa_auth, alfa_app;
    GRANT SELECT, INSERT ON public.people_imports TO alfa_app;
    CREATE POLICY people_imports_tenant ON public.people_imports TO alfa_app
      USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
      WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));
  `);
};

exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
