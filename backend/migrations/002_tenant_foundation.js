exports.up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM public.users WHERE deleted_at IS NULL
                 GROUP BY lower(email) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'FASE0_DUPLICATE_LOGIN_EMAIL: existem emails nao deletados duplicados (case-insensitive); corrija sob decisao administrativa explicita';
      END IF;
    END $$;
    CREATE UNIQUE INDEX users_login_email_unique
      ON public.users (lower(email)) WHERE deleted_at IS NULL;

    DO $$ DECLARE role_name text; BEGIN
      FOREACH role_name IN ARRAY ARRAY['alfa_app', 'alfa_auth'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT', role_name);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name AND
          (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit OR NOT rolcanlogin))
          OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = role_name)
          OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = role_name)
        THEN RAISE EXCEPTION 'FASE0_UNSAFE_ROLE: % precisa de revisao administrativa', role_name;
        END IF;
      END LOOP;
      EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO alfa_app, alfa_auth', current_database());
    END $$;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO alfa_app, alfa_auth;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, alfa_app, alfa_auth;

    CREATE FUNCTION public.school_allows_access(s text, d timestamptz)
    RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
    SET search_path = pg_catalog
    AS $$ SELECT d IS NULL AND s IN ('trial', 'active') $$;
    REVOKE ALL ON FUNCTION public.school_allows_access(text, timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.school_allows_access(text, timestamptz) TO alfa_app, alfa_auth;

    ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.schools FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

    CREATE POLICY schools_tenant ON public.schools TO alfa_app
      USING (id = nullif(current_setting('app.current_school_id', true), '')::uuid
             AND public.school_allows_access(status, deleted_at))
      WITH CHECK (id = nullif(current_setting('app.current_school_id', true), '')::uuid
             AND public.school_allows_access(status, deleted_at));
    CREATE POLICY users_tenant ON public.users TO alfa_app
      USING (school_id = nullif(current_setting('app.current_school_id', true), '')::uuid
             AND EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id))
      WITH CHECK (school_id = nullif(current_setting('app.current_school_id', true), '')::uuid
             AND EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id));
    CREATE POLICY audit_logs_tenant ON public.audit_logs TO alfa_app
      USING (school_id = nullif(current_setting('app.current_school_id', true), '')::uuid
             AND EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id))
      WITH CHECK (school_id = nullif(current_setting('app.current_school_id', true), '')::uuid
             AND EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id));

    -- Excecao explicita de bootstrap: somente a conexao de autenticacao.
    CREATE POLICY users_auth_lookup ON public.users FOR SELECT TO alfa_auth USING (true);
    CREATE POLICY schools_auth_lookup ON public.schools FOR SELECT TO alfa_auth USING (true);
    GRANT SELECT (id, school_id, name, email, password_hash, role, active, deleted_at)
      ON public.users TO alfa_auth;
    GRANT SELECT (id, status, deleted_at) ON public.schools TO alfa_auth;

    -- A API atual so possui endpoints de leitura. DML permanece negado.
    GRANT SELECT (id, school_id, name, email, role, active, created_at, updated_at, deleted_at)
      ON public.users TO alfa_app;
    GRANT SELECT ON public.schools, public.audit_logs TO alfa_app;
  `);
};
exports.down = () => {
  throw new Error('Rollback de isolamento bloqueado: exige plano administrativo explicito');
};
