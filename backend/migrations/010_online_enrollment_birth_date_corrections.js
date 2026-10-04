// Correção da data de nascimento do convite pela escola. A data é o segundo fator da família;
// digitada errada, a família não entra e o convite não podia ser refeito para o mesmo interessado.
// Mantém o padrão da entrega 6: só inserção, a última correção vale e o histórico é preservado.

// Data vigente do convite: última correção registrada pela escola, senão a original.
const birthDate = `COALESCE((SELECT c.child_birth_date FROM public.online_enrollment_birth_date_corrections c
    WHERE c.school_id = a.school_id AND c.application_id = a.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1),
    a.child_birth_date)`;

// As definições abaixo repetem as da migration 009, trocando a data original pela vigente.
const validLink = `
  FROM public.online_enrollment_links l
  JOIN public.schools s ON s.id = l.school_id AND public.school_allows_access(s.status, s.deleted_at)
  JOIN public.online_enrollments a ON a.school_id = l.school_id AND a.id = l.application_id
  WHERE l.token_hash = p_token_hash AND l.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM public.online_enrollment_link_revocations r
      WHERE r.school_id = l.school_id AND r.link_id = l.id)`;

// Tentativas erradas desde o último acesso correto ou a última correção da data; com 5, o link fica bloqueado.
// Corrigir a data libera a família que errou porque a escola tinha registrado a data errada.
const failures = `(SELECT count(*) FROM public.online_enrollment_access_attempts t
  WHERE t.school_id = v_link.school_id AND t.link_id = v_link.id AND NOT t.success
    AND t.created_at > GREATEST(
      COALESCE((SELECT max(t2.created_at) FROM public.online_enrollment_access_attempts t2
        WHERE t2.school_id = v_link.school_id AND t2.link_id = v_link.id AND t2.success), '-infinity'::timestamptz),
      COALESCE((SELECT max(c.created_at) FROM public.online_enrollment_birth_date_corrections c
        WHERE c.school_id = v_link.school_id AND c.application_id = v_link.application_id), '-infinity'::timestamptz)))`;

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

const verify = `
  SELECT l.id, l.school_id, l.application_id, ${birthDate} AS child_birth_date, s.name AS school_name INTO v_link ${validLink};
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
    CREATE TABLE public.online_enrollment_birth_date_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      application_id uuid NOT NULL,
      child_birth_date date NOT NULL CHECK (child_birth_date >= DATE '1900-01-01' AND child_birth_date <= CURRENT_DATE),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, application_id) REFERENCES public.online_enrollments(school_id, id)
    );
    CREATE INDEX online_enrollment_birth_date_corrections_application
      ON public.online_enrollment_birth_date_corrections(school_id, application_id, created_at DESC, id DESC);

    ALTER TABLE public.online_enrollment_birth_date_corrections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.online_enrollment_birth_date_corrections FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON public.online_enrollment_birth_date_corrections FROM PUBLIC, alfa_auth, alfa_app;
    GRANT SELECT, INSERT ON public.online_enrollment_birth_date_corrections TO alfa_app;
    CREATE POLICY online_enrollment_tenant ON public.online_enrollment_birth_date_corrections TO alfa_app
      USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
      WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));
    GRANT SELECT ON public.online_enrollment_birth_date_corrections TO alfa_family_owner;
    CREATE POLICY family_owner_read ON public.online_enrollment_birth_date_corrections
      FOR SELECT TO alfa_family_owner USING (true);

    ALTER TABLE public.online_enrollment_events DROP CONSTRAINT online_enrollment_events_operation_check;
    ALTER TABLE public.online_enrollment_events ADD CONSTRAINT online_enrollment_events_operation_check
      CHECK (operation IN ('settings','applications','links','reviews','birth-date-corrections'));

    -- Mesmas assinaturas, dono, permissões e configuração da migration 009; só o corpo muda.
    CREATE OR REPLACE FUNCTION family_public.application(p_token_hash text, p_birth_date date) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
    DECLARE v_link record; v_state text;
    BEGIN
      ${verify}
      v_state := ${stateOf};
      RETURN jsonb_build_object('status', 'ok', 'state', v_state, 'school_name', v_link.school_name,
        'application', (SELECT jsonb_build_object('child_name', a.child_name, 'child_birth_date', v_link.child_birth_date,
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

    CREATE OR REPLACE FUNCTION family_public.submit(p_token_hash text, p_birth_date date, p_request_key uuid,
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
  `);
};

exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
