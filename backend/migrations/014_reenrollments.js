// Entrega 10: renovação de matrícula (ADR-009). Esqueleto: só as tabelas, todas só de inserção.
// O acesso da família pelo link pessoal (funções de family_public) entra na implementação da entrega.
const tables = ['reenrollment_campaigns','reenrollments','reenrollment_links','reenrollment_link_revocations',
  'reenrollment_access_attempts','reenrollment_document_requests','reenrollment_submissions','reenrollment_reviews',
  'reenrollment_events'];

exports.up = pgm => {
  pgm.sql(`
    -- Campanha: a escola abre a renovação de um período letivo para o seguinte, com prazo para as famílias.
    CREATE TABLE public.reenrollment_campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      from_academic_year_id uuid NOT NULL, to_academic_year_id uuid NOT NULL,
      opens_on date NOT NULL, closes_on date NOT NULL,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (from_academic_year_id <> to_academic_year_id), CHECK (closes_on >= opens_on),
      UNIQUE (school_id, id), UNIQUE (school_id, from_academic_year_id, to_academic_year_id),
      FOREIGN KEY (school_id, from_academic_year_id) REFERENCES public.academic_years(school_id, id),
      FOREIGN KEY (school_id, to_academic_year_id) REFERENCES public.academic_years(school_id, id),
      FOREIGN KEY (school_id, created_by) REFERENCES public.users(school_id, id)
    );
    -- Uma renovação por aluno e campanha, a partir da matrícula atual dele.
    CREATE TABLE public.reenrollments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      campaign_id uuid NOT NULL, student_id uuid NOT NULL, from_enrollment_id uuid NOT NULL,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, campaign_id, student_id),
      FOREIGN KEY (school_id, campaign_id) REFERENCES public.reenrollment_campaigns(school_id, id),
      FOREIGN KEY (school_id, student_id) REFERENCES public.students(school_id, id),
      FOREIGN KEY (school_id, from_enrollment_id) REFERENCES public.enrollments(school_id, id),
      FOREIGN KEY (school_id, created_by) REFERENCES public.users(school_id, id)
    );
    -- Link pessoal da família, como na matrícula online: só o hash do token fica no banco.
    CREATE TABLE public.reenrollment_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      reenrollment_id uuid NOT NULL,
      token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (expires_at > created_at),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, reenrollment_id) REFERENCES public.reenrollments(school_id, id)
    );
    CREATE TABLE public.reenrollment_link_revocations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      link_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, link_id),
      FOREIGN KEY (school_id, link_id) REFERENCES public.reenrollment_links(school_id, id)
    );
    CREATE TABLE public.reenrollment_access_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      link_id uuid NOT NULL,
      success boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, link_id) REFERENCES public.reenrollment_links(school_id, id)
    );
    -- Lista de documentos que a escola pede; o envio de arquivos fica para o MVP 3 (ADR-008 e ADR-009).
    CREATE TABLE public.reenrollment_document_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      reenrollment_id uuid NOT NULL,
      name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, reenrollment_id) REFERENCES public.reenrollments(school_id, id),
      FOREIGN KEY (school_id, created_by) REFERENCES public.users(school_id, id)
    );
    -- Confirmação da família, com as atualizações propostas; nada é aplicado sem a aprovação da secretaria.
    CREATE TABLE public.reenrollment_submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      reenrollment_id uuid NOT NULL,
      proposed_changes jsonb NOT NULL CHECK (jsonb_typeof(proposed_changes) = 'object'
        AND octet_length(proposed_changes::text) <= 50000),
      request_key uuid NOT NULL, request_hash text NOT NULL,
      confirmed boolean NOT NULL CHECK (confirmed),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, reenrollment_id, request_key),
      FOREIGN KEY (school_id, reenrollment_id) REFERENCES public.reenrollments(school_id, id)
    );
    -- Análise da secretaria. A aprovação cria a matrícula do novo período, na turma escolhida.
    CREATE TABLE public.reenrollment_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      reenrollment_id uuid NOT NULL, submission_id uuid NOT NULL,
      decision text NOT NULL CHECK (decision IN ('aprovada','correcao','recusada')),
      note varchar(1000) CHECK (note IS NULL OR length(btrim(note)) > 0),
      enrollment_id uuid,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (decision = 'aprovada' OR note IS NOT NULL),
      CHECK ((decision = 'aprovada') = (enrollment_id IS NOT NULL)),
      UNIQUE (school_id, id), UNIQUE (school_id, submission_id),
      FOREIGN KEY (school_id, reenrollment_id) REFERENCES public.reenrollments(school_id, id),
      FOREIGN KEY (school_id, submission_id) REFERENCES public.reenrollment_submissions(school_id, id),
      FOREIGN KEY (school_id, enrollment_id) REFERENCES public.enrollments(school_id, id),
      FOREIGN KEY (school_id, created_by) REFERENCES public.users(school_id, id)
    );
    CREATE UNIQUE INDEX reenrollment_reviews_final ON public.reenrollment_reviews(school_id, reenrollment_id)
      WHERE decision IN ('aprovada','recusada');
    CREATE TABLE public.reenrollment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL,
      operation text NOT NULL CHECK (operation IN ('campaigns','reenrollments','links','document-requests','reviews')),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL, result jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (school_id, user_id) REFERENCES public.users(school_id, id),
      UNIQUE (school_id, user_id, operation, request_key)
    );
    CREATE INDEX reenrollment_campaigns_listing ON public.reenrollment_campaigns(school_id, created_at DESC, id DESC);
    CREATE INDEX reenrollments_campaign ON public.reenrollments(school_id, campaign_id, created_at);
    CREATE INDEX reenrollment_links_reenrollment ON public.reenrollment_links(school_id, reenrollment_id);
    CREATE INDEX reenrollment_attempts_link ON public.reenrollment_access_attempts(school_id, link_id, created_at);
    CREATE INDEX reenrollment_documents_reenrollment ON public.reenrollment_document_requests(school_id, reenrollment_id);
    CREATE INDEX reenrollment_submissions_reenrollment ON public.reenrollment_submissions(school_id, reenrollment_id, created_at);
    CREATE INDEX reenrollment_reviews_reenrollment ON public.reenrollment_reviews(school_id, reenrollment_id, created_at);
    CREATE INDEX reenrollment_events_actor ON public.reenrollment_events(school_id, user_id);
  `);
  for (const table of tables) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY reenrollment_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
};
exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
