const tenantTables = ['enrollment_form_settings', 'online_enrollments', 'online_enrollment_links',
  'online_enrollment_link_revocations', 'online_enrollment_access_attempts', 'online_enrollment_submissions',
  'online_enrollment_reviews', 'online_enrollment_events'];

// A família só alcança o banco pelas funções de family_public, executadas como alfa_family_owner.
const ownerReadable = ['enrollment_form_settings', 'online_enrollments', 'online_enrollment_links',
  'online_enrollment_link_revocations', 'online_enrollment_access_attempts', 'online_enrollment_submissions',
  'online_enrollment_reviews'];
const ownerInsertable = ['online_enrollment_access_attempts', 'online_enrollment_submissions'];

// Link válido: não revogado, não expirado e escola com acesso permitido.
const validLink = `
  FROM public.online_enrollment_links l
  JOIN public.schools s ON s.id = l.school_id AND public.school_allows_access(s.status, s.deleted_at)
  JOIN public.online_enrollments a ON a.school_id = l.school_id AND a.id = l.application_id
  WHERE l.token_hash = p_token_hash AND l.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM public.online_enrollment_link_revocations r
      WHERE r.school_id = l.school_id AND r.link_id = l.id)`;

// Tentativas erradas desde o último acesso correto; com 5, o link fica bloqueado.
const failures = `(SELECT count(*) FROM public.online_enrollment_access_attempts t
  WHERE t.school_id = v_link.school_id AND t.link_id = v_link.id AND NOT t.success
    AND t.created_at > COALESCE((SELECT max(t2.created_at) FROM public.online_enrollment_access_attempts t2
      WHERE t2.school_id = v_link.school_id AND t2.link_id = v_link.id AND t2.success), '-infinity'::timestamptz))`;

// Situação: final registrada > correção pendente > enviada > convidada.
const stateOf = `(SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.online_enrollment_reviews rv WHERE rv.school_id = v_link.school_id
      AND rv.application_id = v_link.application_id AND rv.decision = 'aprovada') THEN 'aprovada'
    WHEN EXISTS (SELECT 1 FROM public.online_enrollment_reviews rv WHERE rv.school_id = v_link.school_id
      AND rv.application_id = v_link.application_id AND rv.decision = 'recusada') THEN 'recusada'
    WHEN NOT EXISTS (SELECT 1 FROM public.online_enrollment_submissions sb WHERE sb.school_id = v_link.school_id
      AND sb.application_id = v_link.application_id) THEN 'convidada'
    WHEN EXISTS (SELECT 1 FROM public.online_enrollment_submissions sb WHERE sb.school_id = v_link.school_id
      AND sb.application_id = v_link.application_id
      AND NOT EXISTS (SELECT 1 FROM public.online_enrollment_reviews rv WHERE rv.school_id = sb.school_id
        AND rv.submission_id = sb.id)) THEN 'enviada'
    ELSE 'correcao' END)`;

// Verificação comum às duas funções; registra a tentativa e devolve o link em v_link.
const verify = `
  SELECT l.id, l.school_id, l.application_id, a.child_birth_date, s.name AS school_name INTO v_link ${validLink};
  IF v_link.id IS NULL THEN RETURN jsonb_build_object('status', 'denied'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('family-link:' || v_link.id::text, 0));
  IF ${failures} >= 5 THEN RETURN jsonb_build_object('status', 'blocked'); END IF;
  IF p_birth_date IS NULL OR p_birth_date <> v_link.child_birth_date THEN
    INSERT INTO public.online_enrollment_access_attempts (school_id, link_id, success)
      VALUES (v_link.school_id, v_link.id, false);
    RETURN jsonb_build_object('status', CASE WHEN ${failures} >= 5 THEN 'blocked' ELSE 'denied' END);
  END IF;
  INSERT INTO public.online_enrollment_access_attempts (school_id, link_id, success)
    VALUES (v_link.school_id, v_link.id, true);`;

exports.up = pgm => {
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfa_family_owner') THEN
        CREATE ROLE alfa_family_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS NOINHERIT;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfa_family_owner' AND
          (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
        OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r
          ON r.oid IN (m.member, m.roleid) WHERE r.rolname = 'alfa_family_owner')
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='alfa_family_owner')
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='alfa_family_owner')
        OR EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname='alfa_family_owner')
      THEN RAISE EXCEPTION 'ENTREGA6_UNSAFE_FAMILY_OWNER: revisao administrativa necessaria';
      END IF;
    END $$;

    CREATE TABLE public.enrollment_form_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      required_fields text[] NOT NULL CHECK (required_fields <@
        ARRAY['child_cpf','child_health','guardian_cpf','guardian_email','address','second_guardian']::text[]),
      terms_text varchar(20000) CHECK (terms_text IS NULL OR length(btrim(terms_text)) > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id)
    );
    CREATE TABLE public.online_enrollments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      lead_id uuid,
      child_name varchar(150) NOT NULL CHECK (length(btrim(child_name)) > 0),
      child_birth_date date NOT NULL CHECK (child_birth_date >= DATE '1900-01-01' AND child_birth_date <= CURRENT_DATE),
      guardian_name varchar(150) NOT NULL CHECK (length(btrim(guardian_name)) > 0),
      guardian_phone varchar(30) NOT NULL CHECK (guardian_phone ~ '^[+0-9() .-]+$' AND guardian_phone ~ '[0-9]'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, lead_id),
      FOREIGN KEY (school_id, lead_id) REFERENCES public.admission_leads(school_id, id)
    );
    CREATE TABLE public.online_enrollment_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      application_id uuid NOT NULL,
      token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (expires_at > created_at),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, application_id) REFERENCES public.online_enrollments(school_id, id)
    );
    CREATE TABLE public.online_enrollment_link_revocations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      link_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, link_id),
      FOREIGN KEY (school_id, link_id) REFERENCES public.online_enrollment_links(school_id, id)
    );
    CREATE TABLE public.online_enrollment_access_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      link_id uuid NOT NULL,
      success boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, link_id) REFERENCES public.online_enrollment_links(school_id, id)
    );
    CREATE TABLE public.online_enrollment_submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      application_id uuid NOT NULL,
      settings_id uuid,
      data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 50000),
      request_key uuid NOT NULL, request_hash text NOT NULL,
      terms_accepted boolean NOT NULL CHECK (terms_accepted),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, application_id, request_key),
      FOREIGN KEY (school_id, application_id) REFERENCES public.online_enrollments(school_id, id),
      FOREIGN KEY (school_id, settings_id) REFERENCES public.enrollment_form_settings(school_id, id)
    );
    CREATE TABLE public.online_enrollment_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      application_id uuid NOT NULL, submission_id uuid NOT NULL,
      decision text NOT NULL CHECK (decision IN ('aprovada','correcao','recusada')),
      note varchar(1000) CHECK (note IS NULL OR length(btrim(note)) > 0),
      student_id uuid, enrollment_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (decision = 'aprovada' OR note IS NOT NULL),
      CHECK ((decision = 'aprovada') = (student_id IS NOT NULL AND enrollment_id IS NOT NULL)),
      UNIQUE (school_id, id), UNIQUE (school_id, submission_id),
      FOREIGN KEY (school_id, application_id) REFERENCES public.online_enrollments(school_id, id),
      FOREIGN KEY (school_id, submission_id) REFERENCES public.online_enrollment_submissions(school_id, id),
      FOREIGN KEY (school_id, student_id) REFERENCES public.students(school_id, id)
    );
    CREATE UNIQUE INDEX online_enrollment_reviews_final ON public.online_enrollment_reviews(school_id, application_id)
      WHERE decision IN ('aprovada','recusada');
    CREATE TABLE public.online_enrollment_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL,
      operation text NOT NULL CHECK (operation IN ('settings','applications','links','reviews')),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (school_id, user_id) REFERENCES public.users(school_id, id),
      UNIQUE (school_id, user_id, operation, request_key)
    );
    CREATE INDEX enrollment_form_settings_current ON public.enrollment_form_settings(school_id, created_at DESC, id DESC);
    CREATE INDEX online_enrollments_listing ON public.online_enrollments(school_id, created_at DESC, id DESC);
    CREATE INDEX online_enrollment_links_application ON public.online_enrollment_links(school_id, application_id);
    CREATE INDEX online_enrollment_attempts_link ON public.online_enrollment_access_attempts(school_id, link_id, created_at);
    CREATE INDEX online_enrollment_submissions_application ON public.online_enrollment_submissions(school_id, application_id, created_at);
    CREATE INDEX online_enrollment_reviews_application ON public.online_enrollment_reviews(school_id, application_id, created_at);
    CREATE INDEX online_enrollment_events_entity ON public.online_enrollment_events(school_id, entity_id);
  `);

  for (const table of tenantTables) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY online_enrollment_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
  for (const table of ownerReadable) {
    pgm.sql(`GRANT SELECT ON public.${table} TO alfa_family_owner;
      CREATE POLICY family_owner_read ON public.${table} FOR SELECT TO alfa_family_owner USING (true);`);
  }
  for (const table of ownerInsertable) {
    pgm.sql(`GRANT INSERT ON public.${table} TO alfa_family_owner;
      CREATE POLICY family_owner_insert ON public.${table} FOR INSERT TO alfa_family_owner WITH CHECK (true);`);
  }

  pgm.sql(`
    GRANT USAGE ON SCHEMA public TO alfa_family_owner;
    GRANT SELECT (id, name, status, deleted_at) ON public.schools TO alfa_family_owner;
    CREATE POLICY schools_family_owner_lookup ON public.schools FOR SELECT TO alfa_family_owner USING (true);
    GRANT EXECUTE ON FUNCTION public.school_allows_access(text,timestamptz) TO alfa_family_owner;

    CREATE SCHEMA family_public;
    REVOKE ALL ON SCHEMA family_public FROM PUBLIC, alfa_app, alfa_auth, alfa_family_owner;
    GRANT USAGE ON SCHEMA family_public TO alfa_app, alfa_family_owner;

    -- Abre a ficha: devolve dados de pré-preenchimento, regras da escola e situação.
    CREATE FUNCTION family_public.application(p_token_hash text, p_birth_date date) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
    DECLARE v_link record; v_state text;
    BEGIN
      ${verify}
      v_state := ${stateOf};
      RETURN jsonb_build_object('status', 'ok', 'state', v_state, 'school_name', v_link.school_name,
        'application', (SELECT jsonb_build_object('child_name', a.child_name, 'child_birth_date', a.child_birth_date,
          'guardian_name', a.guardian_name, 'guardian_phone', a.guardian_phone)
          FROM public.online_enrollments a WHERE a.school_id = v_link.school_id AND a.id = v_link.application_id),
        'settings', COALESCE((SELECT jsonb_build_object('id', f.id, 'required_fields', to_jsonb(f.required_fields),
          'terms_text', f.terms_text) FROM public.enrollment_form_settings f WHERE f.school_id = v_link.school_id
          ORDER BY f.created_at DESC, f.id DESC LIMIT 1),
          jsonb_build_object('id', NULL, 'required_fields', '[]'::jsonb, 'terms_text', NULL)),
        'last_submission', (SELECT sb.data FROM public.online_enrollment_submissions sb
          WHERE sb.school_id = v_link.school_id AND sb.application_id = v_link.application_id
          ORDER BY sb.created_at DESC, sb.id DESC LIMIT 1),
        'review_note', (SELECT rv.note FROM public.online_enrollment_reviews rv
          WHERE rv.school_id = v_link.school_id AND rv.application_id = v_link.application_id
          ORDER BY rv.created_at DESC, rv.id DESC LIMIT 1));
    END
    $function$;

    -- Envia a ficha: só quando convidada ou em correção, com as regras vigentes da escola.
    CREATE FUNCTION family_public.submit(p_token_hash text, p_birth_date date, p_request_key uuid,
      p_request_hash text, p_settings_id uuid, p_data jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
    DECLARE v_link record; v_state text; v_previous record; v_current uuid; v_id uuid;
    BEGIN
      IF p_request_key IS NULL OR p_request_hash IS NULL OR p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
        RETURN jsonb_build_object('status', 'invalid');
      END IF;
      ${verify}
      PERFORM pg_advisory_xact_lock(hashtextextended('family-application:' || v_link.application_id::text, 0));
      SELECT sb.id, sb.request_hash INTO v_previous FROM public.online_enrollment_submissions sb
        WHERE sb.school_id = v_link.school_id AND sb.application_id = v_link.application_id AND sb.request_key = p_request_key;
      IF v_previous.id IS NOT NULL THEN
        RETURN jsonb_build_object('status', CASE WHEN v_previous.request_hash = p_request_hash THEN 'replayed' ELSE 'conflict' END);
      END IF;
      v_state := ${stateOf};
      IF v_state NOT IN ('convidada', 'correcao') THEN RETURN jsonb_build_object('status', 'closed', 'state', v_state); END IF;
      SELECT f.id INTO v_current FROM public.enrollment_form_settings f WHERE f.school_id = v_link.school_id
        ORDER BY f.created_at DESC, f.id DESC LIMIT 1;
      IF v_current IS DISTINCT FROM p_settings_id THEN RETURN jsonb_build_object('status', 'settings_changed'); END IF;
      INSERT INTO public.online_enrollment_submissions (school_id, application_id, settings_id, data, request_key,
        request_hash, terms_accepted)
      VALUES (v_link.school_id, v_link.application_id, p_settings_id, p_data, p_request_key, p_request_hash, true)
      RETURNING id INTO v_id;
      RETURN jsonb_build_object('status', 'created');
    END
    $function$;

    DO $$ DECLARE f text; BEGIN
      FOREACH f IN ARRAY ARRAY['family_public.application(text,date)',
        'family_public.submit(text,date,uuid,text,uuid,jsonb)'] LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO alfa_family_owner', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, alfa_auth', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO alfa_app', f);
      END LOOP;
    END $$;
  `);
};

exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
