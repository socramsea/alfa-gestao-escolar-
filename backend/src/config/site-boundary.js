// Verificação de catálogo das fronteiras públicas (migrations 008 e 009): sem ler conteúdo de tabelas.
async function assertDefinerBoundary(client, { schema, owner, signatures, label }) {
  const reject = () => { throw new Error(`Fronteira publica ${label} insegura ou migration ausente`); };
  const { rows: [role] } = await client.query(`SELECT rolcanlogin, rolsuper, rolbypassrls,
    rolcreatedb, rolcreaterole, rolreplication, rolinherit,
    EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS membership,
    EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid) AS owns_relation,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid) AS owns_schema
    FROM pg_roles r WHERE rolname=$1`, [owner]);
  if (!role || Object.values(role).some(Boolean)) reject();

  const { rows: [access] } = await client.query(`SELECT
    has_schema_privilege('alfa_app',$1,'CREATE') OR has_schema_privilege('alfa_auth',$1,'CREATE')
      OR has_schema_privilege($2,$1,'CREATE') AS writable,
    has_schema_privilege('alfa_auth',$1,'USAGE') AS auth_usage,
    EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE n.nspname=$1 AND a.grantee=0) AS public_usage`, [schema, owner]);
  if (Object.values(access).some(Boolean)) reject();

  const { rows } = await client.query(`SELECT p.oid::regprocedure::text AS signature,
    r.rolname AS owner, p.prosecdef, p.proleakproof, p.proconfig,
    has_function_privilege('alfa_app',p.oid,'EXECUTE') AS app_execute,
    has_function_privilege('alfa_auth',p.oid,'EXECUTE') AS auth_execute,
    EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND (a.grantee NOT IN
        (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='alfa_app'))
        OR (a.grantee<>p.proowner AND a.is_grantable))) AS unsafe_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname=$1`, [schema]);
  if (rows.length !== signatures.length || rows.some(r => !signatures.includes(r.signature)
    || r.owner !== owner || !r.prosecdef || r.proleakproof || !r.app_execute || r.auth_execute
    || r.unsafe_acl || r.proconfig?.length !== 2
    || !r.proconfig.includes('search_path=pg_catalog, pg_temp') || !r.proconfig.includes('row_security=on'))) reject();
}

export async function assertSiteBoundary(client) {
  await assertDefinerBoundary(client, { schema: 'site_public', owner: 'alfa_site_owner', label: 'do site',
    signatures: ['site_public.site(text)', 'site_public.image(text,uuid)', 'site_public.submit_lead(text,uuid,text,jsonb,uuid)'] });
  await assertDefinerBoundary(client, { schema: 'family_public', owner: 'alfa_family_owner', label: 'da familia',
    signatures: ['family_public.application(text,date)', 'family_public.submit(text,date,uuid,text,uuid,jsonb)'] });
}
