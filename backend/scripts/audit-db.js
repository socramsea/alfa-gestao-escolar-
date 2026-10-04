import 'dotenv/config';
import assert from 'node:assert/strict';
import { pool } from '../src/config/admin-db.js';
import { assertAuthBoundary } from '../src/config/auth-boundary.js';
try {
  for (const [key, role] of [['DATABASE_URL','alfa_app'],['AUTH_DATABASE_URL','alfa_auth']]) {
    const u = new URL(process.env[key]);
    assert.equal(decodeURIComponent(u.username), role);
    console.log(JSON.stringify({ variable: key, role, host: u.hostname, port: u.port, database: u.pathname.slice(1) }));
  }
  const login = await fetch('http://127.0.0.1:4000/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.equal((await fetch('http://127.0.0.1:4000/api/users', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  const connections = (await pool.query(`SELECT DISTINCT a.usename, a.application_name, r.rolsuper, r.rolbypassrls
    FROM pg_stat_activity a JOIN pg_roles r ON r.rolname=a.usename
    WHERE a.datname=current_database() AND a.application_name IN ('alfa-runtime','alfa-authentication')
    ORDER BY a.application_name`)).rows;
  assert.equal(connections.length, 2);
  assert.ok(connections.every(r => !r.rolsuper && !r.rolbypassrls));
  console.log('Conexoes reais da API:', JSON.stringify(connections));
  await assertAuthBoundary(pool);
  console.log('PASS: grants, owner e configuracao das funcoes de autenticacao restritos.');
  for (const [label, sql] of [
    ['Roles', "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname IN ('alfa_app','alfa_auth','alfa_auth_owner') ORDER BY rolname"],
    ['RLS e ownership', "SELECT relname, pg_get_userbyid(relowner) AS owner, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('public.users'::regclass,'public.schools'::regclass,'public.audit_logs'::regclass) ORDER BY relname"],
    ['Policies', "SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname"],
    ['Indice global', "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='users_login_email_unique'"],
    ['Regra central', "SELECT proname, prosecdef, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid='public.school_allows_access(text,timestamptz)'::regprocedure"],
    ['Acesso direto alfa_auth', "SELECT c.relname, has_table_privilege('alfa_auth',c.oid,'SELECT') AS table_select, has_any_column_privilege('alfa_auth',c.oid,'SELECT') AS column_select FROM pg_class c WHERE c.oid IN ('users'::regclass,'schools'::regclass,'audit_logs'::regclass) ORDER BY c.relname"],
    ['Funcoes restritas', "SELECT p.oid::regprocedure::text AS signature, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl, pg_get_function_result(p.oid) AS result FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth_private' ORDER BY p.proname"],
    ['Migrations', 'SELECT name FROM pgmigrations ORDER BY id'],
    ['Escolas ficticias', 'SELECT name,status,deleted_at FROM schools ORDER BY name']
  ]) console.log(`${label}:`, JSON.stringify((await pool.query(sql)).rows, null, 2));
  console.log('PASS: conexoes reais da API e controles PostgreSQL auditados.');
} catch { console.error('Auditoria falhou; verifique API, roles e configuracao local.'); process.exitCode = 1; }
finally { await pool.end(); }
