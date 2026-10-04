// Catalog checks only: no hashes or passwords are read into the application.
export async function assertAuthBoundary(client) {
  const reject = () => { throw new Error('Fronteira de autenticacao insegura ou migration 003 ausente'); };
  const { rows: [owner] } = await client.query(`SELECT rolcanlogin, rolsuper, rolbypassrls,
    rolcreatedb, rolcreaterole, rolreplication, rolinherit,
    EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS membership,
    EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid) AS owns_relation,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid) AS owns_schema
    FROM pg_roles r WHERE rolname='alfa_auth_owner'`);
  if (!owner || Object.values(owner).some(Boolean)) reject();

  const { rows: [access] } = await client.query(`SELECT
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','auth_private') AND c.relkind IN ('r','p','v','m','f') AND (
        has_table_privilege('alfa_auth',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege('alfa_auth',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS direct_access,
    EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','auth_private') AND (
      has_schema_privilege('alfa_auth',n.oid,'CREATE') OR has_schema_privilege('alfa_app',n.oid,'CREATE')
      OR has_schema_privilege('alfa_auth_owner',n.oid,'CREATE'))) AS schema_write,
    EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE n.nspname='auth_private' AND a.grantee=0) AS public_schema_access`);
  if (Object.values(access).some(Boolean)) reject();

  const { rows } = await client.query(`SELECT p.oid::regprocedure::text AS signature,
    r.rolname AS owner, p.prosecdef, p.proleakproof, p.proconfig,
    has_function_privilege('alfa_auth',p.oid,'EXECUTE') AS auth_execute,
    has_function_privilege('alfa_app',p.oid,'EXECUTE') AS app_execute,
    EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND (a.grantee NOT IN
        (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='alfa_auth'))
        OR (a.grantee<>p.proowner AND a.is_grantable))) AS unsafe_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname='auth_private'`);
  const signatures = ['auth_private.authenticate(text,text)', 'auth_private.resolve_identity(uuid)'];
  if (rows.length !== signatures.length || rows.some(r => !signatures.includes(r.signature)
    || r.owner !== 'alfa_auth_owner' || !r.prosecdef || r.proleakproof || !r.auth_execute
    || r.app_execute || r.unsafe_acl || r.proconfig?.length !== 2
    || !r.proconfig.includes('search_path=pg_catalog, pg_temp') || !r.proconfig.includes('row_security=on'))) reject();
}
