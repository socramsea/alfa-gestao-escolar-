const tenantTables = ['school_site_addresses', 'school_site_versions', 'site_images', 'admission_leads',
  'admission_lead_updates', 'visit_slots', 'visit_slot_closures', 'visit_bookings', 'visit_booking_outcomes',
  'admission_events'];

// Leitura pública passa somente pelas funções de site_public, executadas como alfa_site_owner.
const ownerReadable = ['school_site_addresses', 'school_site_versions', 'site_images', 'admission_leads',
  'visit_slots', 'visit_slot_closures', 'visit_bookings', 'visit_booking_outcomes'];
const ownerInsertable = ['admission_leads', 'visit_bookings'];

// Mesma escola, mesmo formato e mesma última versão publicada em todas as funções.
const publishedSchool = `
  FROM public.school_site_addresses a
  JOIN public.schools s ON s.id = a.school_id AND public.school_allows_access(s.status, s.deleted_at)
  JOIN LATERAL (SELECT v.content, v.published FROM public.school_site_versions v
    WHERE v.school_id = a.school_id ORDER BY v.created_at DESC, v.id DESC LIMIT 1) v ON v.published
  WHERE a.slug = p_slug`;

const activeBookings = slot => `(SELECT count(*) FROM public.visit_bookings b
  WHERE b.school_id = ${slot}.school_id AND b.slot_id = ${slot}.id
    AND NOT EXISTS (SELECT 1 FROM public.visit_booking_outcomes o
      WHERE o.school_id = b.school_id AND o.booking_id = b.id AND o.outcome = 'cancelada'))`;

exports.up = pgm => {
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfa_site_owner') THEN
        CREATE ROLE alfa_site_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS NOINHERIT;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfa_site_owner' AND
          (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
        OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r
          ON r.oid IN (m.member, m.roleid) WHERE r.rolname = 'alfa_site_owner')
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='alfa_site_owner')
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='alfa_site_owner')
        OR EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname='alfa_site_owner')
      THEN RAISE EXCEPTION 'ENTREGA5_UNSAFE_SITE_OWNER: revisao administrativa necessaria';
      END IF;
    END $$;

    CREATE TABLE public.school_site_addresses (
      school_id uuid PRIMARY KEY REFERENCES public.schools(id),
      slug varchar(60) NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 60 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.school_site_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.school_site_addresses(school_id),
      content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 200000),
      published boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id)
    );
    CREATE TABLE public.site_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
      data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id, id)
    );
    CREATE TABLE public.admission_leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      protocol varchar(9) NOT NULL CHECK (protocol ~ '^PM-[A-HJ-NP-Z2-9]{6}$'),
      request_key uuid, request_hash text,
      source text NOT NULL CHECK (source IN ('site','whatsapp','indicacao','instagram','presencial','outro')),
      interest text NOT NULL CHECK (interest IN ('visita','matricula','informacoes')),
      guardian_name varchar(150) NOT NULL CHECK (length(btrim(guardian_name)) > 0),
      guardian_phone varchar(30) NOT NULL CHECK (guardian_phone ~ '^[+0-9() .-]+$' AND guardian_phone ~ '[0-9]'),
      guardian_email varchar(150) CHECK (guardian_email IS NULL OR length(btrim(guardian_email)) > 0),
      child_name varchar(150) NOT NULL CHECK (length(btrim(child_name)) > 0),
      child_birth_date date,
      desired_level varchar(80) CHECK (desired_level IS NULL OR length(btrim(desired_level)) > 0),
      how_heard varchar(120) CHECK (how_heard IS NULL OR length(btrim(how_heard)) > 0),
      message varchar(1000) CHECK (message IS NULL OR length(btrim(message)) > 0),
      consent_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((request_key IS NULL) = (request_hash IS NULL)),
      UNIQUE (school_id, id), UNIQUE (school_id, protocol), UNIQUE (school_id, request_key)
    );
    CREATE TABLE public.admission_lead_updates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      lead_id uuid NOT NULL,
      status text CHECK (status IS NULL OR status IN ('em_contato','visitou','matriculado','desistiu')),
      note varchar(1000) CHECK (note IS NULL OR length(btrim(note)) > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK (status IS NOT NULL OR note IS NOT NULL),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, lead_id) REFERENCES public.admission_leads(school_id, id)
    );
    CREATE TABLE public.visit_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      starts_at timestamptz NOT NULL,
      capacity smallint NOT NULL CHECK (capacity BETWEEN 1 AND 20),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id, id), UNIQUE (school_id, starts_at)
    );
    CREATE TABLE public.visit_slot_closures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      slot_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id, id), UNIQUE (school_id, slot_id),
      FOREIGN KEY (school_id, slot_id) REFERENCES public.visit_slots(school_id, id)
    );
    CREATE TABLE public.visit_bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      lead_id uuid NOT NULL, slot_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id),
      FOREIGN KEY (school_id, lead_id) REFERENCES public.admission_leads(school_id, id),
      FOREIGN KEY (school_id, slot_id) REFERENCES public.visit_slots(school_id, id)
    );
    CREATE TABLE public.visit_booking_outcomes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      booking_id uuid NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('compareceu','nao_compareceu','cancelada')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (school_id, id), UNIQUE (school_id, booking_id),
      FOREIGN KEY (school_id, booking_id) REFERENCES public.visit_bookings(school_id, id)
    );
    CREATE TABLE public.admission_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES public.schools(id),
      user_id uuid NOT NULL,
      operation text NOT NULL CHECK (operation IN ('site-address','site-versions','site-images','leads',
        'lead-updates','visit-slots','visit-slot-closures','visit-bookings','visit-outcomes')),
      request_key uuid NOT NULL, payload_hash text NOT NULL, entity_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (school_id, user_id) REFERENCES public.users(school_id, id),
      UNIQUE (school_id, user_id, operation, request_key)
    );
    CREATE INDEX school_site_versions_current ON public.school_site_versions(school_id, created_at DESC, id DESC);
    CREATE INDEX site_images_listing ON public.site_images(school_id, created_at, id);
    CREATE INDEX admission_leads_listing ON public.admission_leads(school_id, created_at DESC, id DESC);
    CREATE INDEX admission_lead_updates_lead ON public.admission_lead_updates(school_id, lead_id, created_at);
    CREATE INDEX visit_slots_listing ON public.visit_slots(school_id, starts_at);
    CREATE INDEX visit_bookings_slot ON public.visit_bookings(school_id, slot_id);
    CREATE INDEX visit_bookings_lead ON public.visit_bookings(school_id, lead_id, created_at);
    CREATE INDEX admission_events_entity ON public.admission_events(school_id, entity_id);
  `);

  for (const table of tenantTables) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.${table} FROM PUBLIC, alfa_auth, alfa_app;
      GRANT SELECT, INSERT ON public.${table} TO alfa_app;
      CREATE POLICY admissions_tenant ON public.${table} TO alfa_app
        USING (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id))
        WITH CHECK (school_id=nullif(current_setting('app.current_school_id',true),'')::uuid
          AND EXISTS(SELECT 1 FROM public.schools s WHERE s.id=school_id));`);
  }
  for (const table of ownerReadable) {
    pgm.sql(`GRANT SELECT ON public.${table} TO alfa_site_owner;
      CREATE POLICY site_owner_read ON public.${table} FOR SELECT TO alfa_site_owner USING (true);`);
  }
  for (const table of ownerInsertable) {
    pgm.sql(`GRANT INSERT ON public.${table} TO alfa_site_owner;
      CREATE POLICY site_owner_insert ON public.${table} FOR INSERT TO alfa_site_owner WITH CHECK (true);`);
  }

  pgm.sql(`
    GRANT USAGE ON SCHEMA public TO alfa_site_owner;
    GRANT SELECT (id, name, status, deleted_at) ON public.schools TO alfa_site_owner;
    CREATE POLICY schools_site_owner_lookup ON public.schools FOR SELECT TO alfa_site_owner USING (true);
    GRANT EXECUTE ON FUNCTION public.school_allows_access(text,timestamptz) TO alfa_site_owner;

    CREATE SCHEMA site_public;
    REVOKE ALL ON SCHEMA site_public FROM PUBLIC, alfa_app, alfa_auth, alfa_site_owner;
    GRANT USAGE ON SCHEMA site_public TO alfa_app, alfa_site_owner;

    CREATE FUNCTION site_public.site(p_slug text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
      SELECT jsonb_build_object('school_name', s.name, 'slug', a.slug, 'content', v.content,
        'visit_slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vs.id, 'starts_at', vs.starts_at) ORDER BY vs.starts_at)
          FROM public.visit_slots vs
          WHERE vs.school_id = s.id
            AND vs.starts_at > now() + interval '2 hours' AND vs.starts_at < now() + interval '45 days'
            AND NOT EXISTS (SELECT 1 FROM public.visit_slot_closures c WHERE c.school_id = vs.school_id AND c.slot_id = vs.id)
            AND vs.capacity > ${activeBookings('vs')}), '[]'::jsonb))
      ${publishedSchool}
    $function$;

  `);

  pgm.sql(`
    CREATE FUNCTION site_public.image(p_slug text, p_image_id uuid)
    RETURNS TABLE (content_type text, data bytea)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
      SELECT i.content_type, i.data
      FROM public.school_site_addresses a
      JOIN public.schools s ON s.id = a.school_id AND public.school_allows_access(s.status, s.deleted_at)
      JOIN LATERAL (SELECT v.content, v.published FROM public.school_site_versions v
        WHERE v.school_id = a.school_id ORDER BY v.created_at DESC, v.id DESC LIMIT 1) v ON v.published
      JOIN public.site_images i ON i.school_id = a.school_id AND i.id = p_image_id
      WHERE a.slug = p_slug
        AND jsonb_path_exists(v.content, '$.** ? (@ == $id)', jsonb_build_object('id', p_image_id::text))
    $function$;

    CREATE FUNCTION site_public.submit_lead(p_slug text, p_request_key uuid, p_request_hash text,
      p_lead jsonb, p_slot_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
    DECLARE
      v_school uuid;
      v_previous record;
      v_slot_id uuid;
      v_slot_starts timestamptz;
      v_lead uuid;
      v_protocol text;
      v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    BEGIN
      IF p_slug IS NULL OR p_request_key IS NULL OR p_request_hash IS NULL
        OR p_lead IS NULL OR jsonb_typeof(p_lead) <> 'object' THEN
        RETURN NULL;
      END IF;
      SELECT a.school_id INTO v_school ${publishedSchool};
      IF v_school IS NULL THEN RETURN NULL; END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended('site-lead:' || v_school::text || ':' || p_request_key::text, 0));
      SELECT l.id, l.protocol, l.request_hash INTO v_previous FROM public.admission_leads l
        WHERE l.school_id = v_school AND l.request_key = p_request_key;
      IF FOUND THEN
        IF v_previous.request_hash <> p_request_hash THEN RETURN jsonb_build_object('status', 'conflict'); END IF;
        RETURN jsonb_build_object('status', 'replayed', 'protocol', v_previous.protocol,
          'visit_starts_at', (SELECT vs.starts_at FROM public.visit_bookings b
            JOIN public.visit_slots vs ON vs.school_id = b.school_id AND vs.id = b.slot_id
            WHERE b.school_id = v_school AND b.lead_id = v_previous.id ORDER BY b.created_at LIMIT 1));
      END IF;

      IF p_slot_id IS NOT NULL THEN
        -- Mesma trava usada pela equipe ao reservar: a capacidade vale para os dois caminhos.
        PERFORM pg_advisory_xact_lock(hashtextextended('visit-slot:' || p_slot_id::text, 0));
        SELECT vs.id, vs.starts_at INTO v_slot_id, v_slot_starts FROM public.visit_slots vs
          WHERE vs.school_id = v_school AND vs.id = p_slot_id
            AND vs.starts_at > now() + interval '2 hours'
            AND NOT EXISTS (SELECT 1 FROM public.visit_slot_closures c WHERE c.school_id = vs.school_id AND c.slot_id = vs.id)
            AND vs.capacity > ${activeBookings('vs')};
        IF v_slot_id IS NULL THEN RETURN jsonb_build_object('status', 'slot_unavailable'); END IF;
      END IF;

      FOR attempt IN 1..8 LOOP
        v_protocol := 'PM-' || (SELECT string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '')
          FROM generate_series(1, 6));
        INSERT INTO public.admission_leads (school_id, protocol, request_key, request_hash, source, interest,
          guardian_name, guardian_phone, guardian_email, child_name, child_birth_date, desired_level,
          how_heard, message, consent_at)
        VALUES (v_school, v_protocol, p_request_key, p_request_hash, 'site', p_lead->>'interest',
          p_lead->>'guardian_name', p_lead->>'guardian_phone', p_lead->>'guardian_email', p_lead->>'child_name',
          (p_lead->>'child_birth_date')::date, p_lead->>'desired_level', p_lead->>'how_heard', p_lead->>'message', now())
        ON CONFLICT (school_id, protocol) DO NOTHING
        RETURNING id INTO v_lead;
        EXIT WHEN v_lead IS NOT NULL;
      END LOOP;
      IF v_lead IS NULL THEN RAISE EXCEPTION 'protocolo indisponivel'; END IF;

      IF v_slot_id IS NOT NULL THEN
        INSERT INTO public.visit_bookings (school_id, lead_id, slot_id) VALUES (v_school, v_lead, v_slot_id);
      END IF;
      RETURN jsonb_build_object('status', 'created', 'protocol', v_protocol, 'visit_starts_at', v_slot_starts);
    END
    $function$;
  `);

  pgm.sql(`
    DO $$ DECLARE f text; BEGIN
      FOREACH f IN ARRAY ARRAY['site_public.site(text)', 'site_public.image(text,uuid)',
        'site_public.submit_lead(text,uuid,text,jsonb,uuid)'] LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO alfa_site_owner', f);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, alfa_auth', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO alfa_app', f);
      END LOOP;
    END $$;
  `);
};

exports.down = () => { throw new Error('Rollback exige plano administrativo explicito'); };
