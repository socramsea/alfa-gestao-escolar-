exports.up = (pgm) => {
  pgm.sql(`
    -- Abort before touching privileges if an existing identity needs another verifier.
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM public.users WHERE deleted_at IS NULL
          AND password_hash !~ '^[$]2a[$](0[4-9]|[12][0-9]|3[01])[$][./A-Za-z0-9]{53}$') THEN
        RAISE EXCEPTION 'FASE0_UNSUPPORTED_PASSWORD_HASH: identidade nao deletada fora do bcrypt 2a; nenhuma senha foi alterada';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfa_auth_owner') THEN
        CREATE ROLE alfa_auth_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION NOBYPASSRLS NOINHERIT;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfa_auth_owner' AND
          (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit))
        OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r
          ON r.oid IN (m.member, m.roleid) WHERE r.rolname = 'alfa_auth_owner')
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='alfa_auth_owner')
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='alfa_auth_owner')
        OR EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE r.rolname='alfa_auth_owner')
      THEN RAISE EXCEPTION 'FASE0_UNSAFE_AUTH_OWNER: revisao administrativa necessaria';
      END IF;
    END $$;

    CREATE SCHEMA auth_private;
    REVOKE ALL ON SCHEMA auth_private FROM PUBLIC, alfa_app, alfa_auth, alfa_auth_owner;
    GRANT USAGE ON SCHEMA auth_private TO alfa_auth, alfa_auth_owner;
    GRANT USAGE ON SCHEMA public TO alfa_auth_owner;

    -- Table REVOKE alone does not remove the column grants from migration 002.
    REVOKE ALL ON public.users, public.schools, public.audit_logs FROM alfa_auth;
    REVOKE SELECT (id, school_id, name, email, password_hash, role, active, deleted_at)
      ON public.users FROM alfa_auth;
    REVOKE SELECT (id, status, deleted_at) ON public.schools FROM alfa_auth;
    REVOKE EXECUTE ON FUNCTION public.school_allows_access(text,timestamptz) FROM alfa_auth;
    DROP POLICY users_auth_lookup ON public.users;
    DROP POLICY schools_auth_lookup ON public.schools;

    GRANT SELECT (id, school_id, name, email, password_hash, role, active, deleted_at)
      ON public.users TO alfa_auth_owner;
    GRANT SELECT (id, status, deleted_at) ON public.schools TO alfa_auth_owner;
    GRANT EXECUTE ON FUNCTION public.school_allows_access(text,timestamptz) TO alfa_auth_owner;
    GRANT EXECUTE ON FUNCTION public.crypt(text,text) TO alfa_auth_owner;
    CREATE POLICY users_auth_owner_lookup ON public.users FOR SELECT TO alfa_auth_owner USING (true);
    CREATE POLICY schools_auth_owner_lookup ON public.schools FOR SELECT TO alfa_auth_owner USING (true);

    CREATE FUNCTION auth_private.authenticate(p_email text, p_password text)
    RETURNS TABLE (id uuid, school_id uuid, name text, email text, role text, active boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
    DECLARE
      identity_row record;
      identity_found boolean := true;
      valid_hash boolean := false;
      password_matches boolean;
      -- Fictitious bcrypt 2a/cost 12: never belongs to a real identity.
      checked_hash text := '$2a$12$xk4vzF3USzdLuqRUljLp7ennrGOYyp92MG0mQ0gKWnJMLZBVCk2/K';
    BEGIN
      IF p_email IS NULL OR char_length(btrim(p_email)) NOT BETWEEN 1 AND 150
        OR p_password IS NULL OR octet_length(p_password) NOT BETWEEN 1 AND 72 THEN
        RETURN;
      END IF;
      BEGIN
        SELECT u.id, u.school_id, u.name, u.email, u.role, u.active, u.password_hash,
          public.school_allows_access(s.status, s.deleted_at) AS school_allowed
          INTO STRICT identity_row
        FROM public.users u JOIN public.schools s ON s.id=u.school_id
        WHERE lower(u.email) = lower(btrim(p_email)) AND u.deleted_at IS NULL;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN identity_found := false;
        WHEN TOO_MANY_ROWS THEN RETURN;
      END;
      IF identity_found THEN
        valid_hash := identity_row.password_hash ~ '^[$]2a[$](0[4-9]|[12][0-9]|3[01])[$][./A-Za-z0-9]{53}$';
        IF valid_hash THEN checked_hash := identity_row.password_hash; END IF;
      END IF;
      -- Execute bcrypt even for absent/invalid identities; never return the hash.
      password_matches := public.crypt(p_password, checked_hash) = checked_hash;
      IF NOT identity_found OR NOT valid_hash OR NOT password_matches THEN RETURN; END IF;
      IF NOT identity_row.active OR NOT identity_row.school_allowed THEN RETURN; END IF;
      RETURN QUERY SELECT identity_row.id, identity_row.school_id,
        identity_row.name::text, identity_row.email::text, identity_row.role::text, identity_row.active;
    END;
    $function$;

    CREATE FUNCTION auth_private.resolve_identity(p_user_id uuid)
    RETURNS TABLE (id uuid, school_id uuid, name text, email text, role text, active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    AS $function$
      SELECT u.id, u.school_id, u.name::text, u.email::text, u.role::text, u.active
      FROM public.users u JOIN public.schools s ON s.id=u.school_id
      WHERE u.id=p_user_id AND u.active AND u.deleted_at IS NULL
        AND public.school_allows_access(s.status, s.deleted_at)
    $function$;

    ALTER FUNCTION auth_private.authenticate(text,text) OWNER TO alfa_auth_owner;
    ALTER FUNCTION auth_private.resolve_identity(uuid) OWNER TO alfa_auth_owner;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth_private FROM PUBLIC, alfa_app, alfa_auth;
    GRANT EXECUTE ON FUNCTION auth_private.authenticate(text,text),
      auth_private.resolve_identity(uuid) TO alfa_auth;
  `);
};
exports.down = () => {
  throw new Error('Rollback de protecao de credenciais bloqueado: exige plano administrativo explicito');
};
