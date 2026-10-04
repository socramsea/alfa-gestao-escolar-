import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { administrativeUrl, pool as admin } from '../../src/config/admin-db.js';

if (process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures') {
  throw new Error('Defina TEST_ALLOW_MUTATION=fictional-fixtures para criar/remover somente fixtures ficticias');
}
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const password = `Test-${randomUUID()}`;
const tag = randomUUID();
const a = { school_id: randomUUID(), sub: randomUUID(), email: `a-${tag}@security.test` };
const b = { school_id: randomUUID(), sub: randomUUID(), email: `b-${tag}@security.test` };
let tokenA, tokenB;
const one = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
async function http(path, token, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
}
async function login(who, extra = {}) {
  return http('/api/auth/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: who.email, password, ...extra }) });
}
async function denied(action, code = '42501') {
  await assert.rejects(action, error => error.code === code);
}
async function transaction(fn) {
  const c = await admin.connect();
  try { await c.query('BEGIN'); return await fn(c); }
  finally { await c.query('ROLLBACK'); c.release(); }
}

before(async () => {
  administrativeUrl();
  const hash = await bcrypt.hash(password, 12);
  for (const who of [a, b]) {
    await admin.query("INSERT INTO schools (id,name,email,status) VALUES ($1,$2,$3,'trial')", [who.school_id, `Security fixture ${tag}`, who.email]);
    await admin.query("INSERT INTO users (id,school_id,name,email,password_hash,role) VALUES ($1,$2,'Security fixture',$3,$4,'school_admin')", [who.sub, who.school_id, who.email, hash]);
    await admin.query("INSERT INTO audit_logs (school_id,user_id,action,entity_type) VALUES ($1,$2,'fixture','security')", [who.school_id, who.sub]);
  }
  const ra = await login(a); assert.equal(ra.status, 200); tokenA = (await ra.json()).token;
  const rb = await login(b); assert.equal(rb.status, 200); tokenB = (await rb.json()).token;
});
after(async () => {
  try {
    await admin.query('DELETE FROM audit_logs WHERE school_id = ANY($1::uuid[])', [[a.school_id, b.school_id]]);
    await admin.query('DELETE FROM users WHERE school_id = ANY($1::uuid[])', [[a.school_id, b.school_id]]);
    await admin.query('DELETE FROM schools WHERE id = ANY($1::uuid[])', [[a.school_id, b.school_id]]);
  } finally { await Promise.all([pool.end(), authPool.end(), one.end(), admin.end()]); }
});

test('runtime usa alfa_app/alfa_auth restritos e RLS FORCE nas tres tabelas', async () => {
  await testDatabaseConnection();
  for (const [p, role] of [[pool, 'alfa_app'], [authPool, 'alfa_auth']]) {
    const { rows: [r] } = await p.query(`SELECT current_user AS role, rolsuper, rolbypassrls, rolcreatedb,
      rolcreaterole, rolreplication FROM pg_roles WHERE rolname=current_user`);
    assert.deepEqual(r, { role, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false });
    for (const sql of ['CREATE DATABASE alfa_forbidden_probe', 'CREATE ROLE alfa_forbidden_probe',
      'ALTER POLICY users_tenant ON users USING (true)', 'ALTER TABLE users DISABLE ROW LEVEL SECURITY',
      'ALTER TABLE users NO FORCE ROW LEVEL SECURITY', 'CREATE TABLE public.forbidden_probe(id int)',
      'CREATE TEMP TABLE forbidden_probe(id int)', 'SET ROLE postgres',
      `SET ROLE ${role === 'alfa_app' ? 'alfa_auth' : 'alfa_app'}`,
      'SELECT * FROM pgmigrations']) await denied(() => p.query(sql));
  }
  const { rows } = await admin.query("SELECT relname, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid IN ('users'::regclass,'schools'::regclass,'audit_logs'::regclass)");
  assert.equal(rows.length, 3); assert.ok(rows.every(r => !['alfa_app','alfa_auth'].includes(r.owner)));
});

test('menor privilegio: auth sem DML/auditoria, runtime sem hashes e sem DML', async () => {
  await denied(() => pool.query('SELECT password_hash FROM users'));
  await denied(() => authPool.query('SELECT * FROM audit_logs'));
  await denied(() => authPool.query('SELECT name FROM schools'));
  for (const p of [pool, authPool]) {
    for (const table of ['users','schools','audit_logs']) {
      await denied(() => p.query(`DELETE FROM ${table} WHERE false`));
      await denied(() => p.query(`UPDATE ${table} SET id=id WHERE false`));
      await denied(() => p.query(`INSERT INTO ${table} (id) VALUES ($1)`, [randomUUID()]));
    }
  }
});

test('sem token, adulterado, expirado e algoritmo indevido retornam 401', async () => {
  assert.equal((await http('/api/auth/me')).status, 401);
  const parts = tokenA.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const opts = { issuer: 'alfa-gestao', audience: 'alfa-api' };
  const payload = { sub: a.sub, school_id: a.school_id };
  for (const token of [parts.join('.'), jwt.sign(payload, process.env.JWT_SECRET, { ...opts, expiresIn: -1 }),
    jwt.sign(payload, process.env.JWT_SECRET, { ...opts, algorithm: 'HS384' })]) {
    assert.equal((await http('/api/auth/me', token)).status, 401);
  }
});

test('A e B isolados em users, schools e me; nenhuma resposta contem hash', async () => {
  for (const [who, token] of [[a, tokenA], [b, tokenB]]) {
    const ur = await http('/api/users', token); assert.equal(ur.status, 200);
    const body = await ur.json(); assert.ok(body.users.length > 0);
    assert.ok(body.users.every(u => u.school_id === who.school_id));
    assert.ok(body.users.every(u => !('password_hash' in u)));
    const sr = await http('/api/schools', token); assert.equal(sr.status, 200);
    assert.deepEqual((await sr.json()).schools.map(s => s.id), [who.school_id]);
    const mr = await http('/api/auth/me', token); assert.equal(mr.status, 200);
    const me = (await mr.json()).user; assert.equal(me.id, who.sub); assert.equal(me.school_id, who.school_id);
  }
});

test('school_id de body/query/header/params nao muda tenant; login rejeita seletor', async () => {
  assert.equal((await login(a, { school_id: b.school_id })).status, 400);
  const r = await http(`/api/users?school_id=${b.school_id}`, tokenA, { headers: { 'X-School-Id': b.school_id } });
  assert.equal(r.status, 200); assert.ok((await r.json()).users.every(u => u.school_id === a.school_id));
  const mr = await http(`/api/auth/me?school_id=${b.school_id}&id=${b.sub}`, tokenA);
  assert.equal((await mr.json()).user.id, a.sub);
  // Nao se cria endpoint de negocio por UUID so para testa-lo: rota inexistente fica 404.
  assert.equal((await http(`/api/users/${b.sub}`, tokenA)).status, 404);
  assert.equal((await http('/api/users', tokenA, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ school_id: b.school_id }) })).status, 404);
});

test('UUID de outro tenant bloqueado pelo banco; JWT assinado com vinculo falso rejeitado', async () => {
  for (const [who, other] of [[a,b],[b,a]]) {
    await withTenant(who, async c => {
      assert.equal((await c.query('SELECT id FROM users WHERE id=$1', [other.sub])).rowCount, 0);
      assert.equal((await c.query('SELECT id FROM schools WHERE id=$1', [other.school_id])).rowCount, 0);
    });
    const token = jwt.sign({ sub: who.sub, school_id: other.school_id, role: 'platform_admin' }, process.env.JWT_SECRET,
      { issuer: 'alfa-gestao', audience: 'alfa-api', expiresIn: '1h' });
    assert.equal((await http('/api/auth/me', token)).status, 401);
  }
});

test('role atual no banco prevalece sobre JWT antigo: 403', async () => {
  await admin.query("UPDATE users SET role='teacher' WHERE id=$1", [a.sub]);
  try {
    assert.equal((await http('/api/users', tokenA)).status, 403);
    assert.equal((await http('/api/schools', tokenA)).status, 403);
    const me = await http('/api/auth/me', tokenA); assert.equal(me.status, 200);
    assert.equal((await me.json()).user.role, 'teacher');
  } finally { await admin.query("UPDATE users SET role='school_admin' WHERE id=$1", [a.sub]); }
});

for (const mutation of ['active=false', 'deleted_at=now()']) {
  test(`usuario ${mutation} bloqueia login e token emitido anteriormente`, async () => {
    await admin.query(`UPDATE users SET ${mutation} WHERE id=$1`, [a.sub]);
    try {
      assert.equal((await login(a)).status, 401);
      for (const path of ['/api/auth/me','/api/users','/api/schools']) assert.equal((await http(path, tokenA)).status, 401);
      await assert.rejects(() => withTenant(a, async () => {}), e => e.statusCode === 401);
    } finally { await admin.query('UPDATE users SET active=true, deleted_at=NULL WHERE id=$1', [a.sub]); }
  });
}
for (const status of ['trial','active','inactive','suspended','unknown']) {
  test(`escola status=${status}: regra central aplicada no login, middleware e RLS`, async () => {
    const allowed = ['trial','active'].includes(status);
    await admin.query('UPDATE schools SET status=$1 WHERE id=$2', [status, a.school_id]);
    try {
      assert.equal((await login(a)).status, allowed ? 200 : 401);
      for (const path of ['/api/auth/me','/api/users','/api/schools']) assert.equal((await http(path, tokenA)).status, allowed ? 200 : 401);
      if (!allowed) await assert.rejects(() => withTenant(a, async () => {}), e => e.statusCode === 401);
    } finally { await admin.query("UPDATE schools SET status='trial' WHERE id=$1", [a.school_id]); }
  });
}
test('escola deletada bloqueia login e acesso com token anterior', async () => {
  await admin.query('UPDATE schools SET deleted_at=now() WHERE id=$1', [a.school_id]);
  try {
    assert.equal((await login(a)).status, 401);
    for (const path of ['/api/auth/me','/api/users','/api/schools']) assert.equal((await http(path, tokenA)).status, 401);
    await assert.rejects(() => withTenant(a, async () => {}), e => e.statusCode === 401);
  } finally { await admin.query('UPDATE schools SET deleted_at=NULL WHERE id=$1', [a.school_id]); }
});

test('RLS filtra users/audit_logs/schools mesmo sem WHERE em ambos os tenants', async () => {
  for (const who of [a,b]) await withTenant(who, async c => {
    for (const table of ['users','audit_logs','schools']) {
      const key = table === 'schools' ? 'id' : 'school_id';
      const { rows } = await c.query(`SELECT ${key} FROM ${table}`);
      assert.ok(rows.length > 0); assert.ok(rows.every(r => r[key] === who.school_id));
    }
  });
  for (const table of ['users','audit_logs','schools']) {
    assert.equal((await pool.query(`SELECT id FROM ${table}`)).rowCount, 0);
  }
});

for (const table of ['users','audit_logs','schools']) {
  test(`RLS WITH CHECK bloqueia INSERT/UPDATE cross-tenant em ${table}, mesmo com grant temporario`, async () => {
    for (const [who, other] of [[a,b],[b,a]]) await transaction(async c => {
      await c.query(`GRANT INSERT, UPDATE ON ${table} TO alfa_app`);
      await c.query('SET LOCAL ROLE alfa_app');
      await c.query("SELECT set_config('app.current_school_id',$1,true)", [who.school_id]);
      const values = table === 'users' ? [randomUUID(), other.school_id, `rls-${randomUUID()}@security.test`]
        : table === 'audit_logs' ? [other.school_id] : [randomUUID()];
      const insert = table === 'users'
        ? "INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'probe',$3,'not-real','teacher')"
        : table === 'audit_logs' ? "INSERT INTO audit_logs(school_id,action,entity_type) VALUES($1,'probe','probe')"
        : "INSERT INTO schools(id,name) VALUES($1,'probe')";
      await c.query('SAVEPOINT probe');
      await assert.rejects(() => c.query(insert, values), e => e.code === '42501' && /row-level security/.test(e.message));
      await c.query('ROLLBACK TO SAVEPOINT probe');
      const key = table === 'schools' ? 'id' : 'school_id';
      await assert.rejects(() => c.query(`UPDATE ${table} SET ${key}=$1`, [other.school_id]),
        e => e.code === '42501' && /row-level security/.test(e.message));
      await c.query('ROLLBACK TO SAVEPOINT probe');
      assert.equal((await c.query(`UPDATE ${table} SET ${key}=${key} WHERE ${key}=$1`, [other.school_id])).rowCount, 0);
      // Controle positivo: uma escrita no proprio tenant passa pela policy.
      assert.ok((await c.query(`UPDATE ${table} SET ${key}=${key}`)).rowCount > 0);
      if (table === 'users') await c.query(insert, [randomUUID(), who.school_id, `own-${randomUUID()}@security.test`]);
      if (table === 'audit_logs') await c.query(insert, [who.school_id]);
    });
  });
}

test('pool max=1 reutiliza mesmo backend sem contexto apos commit/rollback e sob concorrencia', async () => {
  const pids = new Set();
  const probe = who => withTenant(who, async c => {
    pids.add((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    const { rows } = await c.query('SELECT school_id FROM users');
    assert.ok(rows.length > 0 && rows.every(r => r.school_id === who.school_id));
  }, one);
  for (const who of [a,b,a,b]) {
    await probe(who);
    assert.equal((await one.query("SELECT nullif(current_setting('app.current_school_id',true),'') AS tenant")).rows[0].tenant, null);
    assert.equal((await one.query('SELECT id FROM users')).rowCount, 0);
    await assert.rejects(() => withTenant(who, c => c.query('SELECT 1/0'), one), e => e.code === '22012');
    assert.equal((await one.query('SELECT id FROM users')).rowCount, 0);
  }
  await Promise.all(Array.from({ length: 20 }, (_, i) => probe(i % 2 ? a : b)));
  assert.equal(pids.size, 1);
  assert.equal((await one.query('SELECT id FROM users')).rowCount, 0);
});

test('requisicoes concorrentes alternadas nao vazam tenant', async () => {
  await Promise.all(Array.from({ length: 20 }, async (_, i) => {
    const who = i % 2 ? a : b; const token = i % 2 ? tokenA : tokenB;
    const res = await http('/api/users', token); assert.equal(res.status, 200);
    assert.ok((await res.json()).users.every(u => u.school_id === who.school_id));
  }));
});

test('email global case-insensitive unico inclusive inativos, liberado apenas por exclusao logica', async () => {
  await transaction(async c => {
    await c.query('SAVEPOINT duplicate');
    const insert = "INSERT INTO users(school_id,name,email,password_hash,role,active) VALUES($1,'probe',$2,'dummy','teacher',false)";
    await denied(() => c.query(insert, [b.school_id, a.email.toUpperCase()]), '23505');
    await c.query('ROLLBACK TO SAVEPOINT duplicate');
    await c.query('UPDATE users SET deleted_at=now() WHERE id=$1', [a.sub]);
    await c.query(insert, [b.school_id, a.email.toUpperCase()]);
  });
  const res = await login({ ...a, email: a.email.toUpperCase() }); assert.equal(res.status, 200);
  assert.equal((await res.json()).user.id, a.sub);
});

test('HTTP: sem X-Powered-By, CORS limitado, Zod e JSON invalido', async () => {
  const deniedOrigin = await http('/api/health', null, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(deniedOrigin.headers.get('x-powered-by'), null);
  assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);
  const allowedOrigin = process.env.CORS_ORIGINS.split(',')[0];
  const allowed = await http('/api/health', null, { headers: { Origin: allowedOrigin } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin);
  for (const body of ['{', JSON.stringify({ email: 'bad', password: [] }), JSON.stringify({ email: a.email, password: '' })]) {
    const res = await http('/api/auth/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(res.status, 400); const text = await res.text(); assert.ok(!/stack|SELECT|SyntaxError/.test(text));
  }
  let code, payload;
  errorHandler(new Error('SECRET SQL password stack'), {}, {
    status: s => { code = s; return { json: p => { payload = p; } }; }
  }, () => assert.fail());
  assert.equal(code, 500); assert.deepEqual(payload, { error: 'Erro interno do servidor' });
});

test('falha de conexao durante transacao descarta cliente; proxima conexao fica sem tenant', async () => {
  let failedPid;
  await assert.rejects(() => withTenant(a, async c => {
    // O listener evita um erro de socket nao tratado durante a terminacao deliberada.
    c.on('error', () => {});
    failedPid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await admin.query('SELECT pg_terminate_backend($1)', [failedPid]);
    await c.query('SELECT 1');
  }, one));
  const { rows: [r] } = await one.query("SELECT pg_backend_pid() AS pid, nullif(current_setting('app.current_school_id',true),'') AS tenant");
  assert.notEqual(r.pid, failedPid); assert.equal(r.tenant, null);
  assert.equal((await one.query('SELECT id FROM users')).rowCount, 0);
});

test('limpeza adicional remove contexto de sessao acidental antes de devolver cliente ao pool', async () => {
  await withTenant(a, async c => {
    await c.query("SELECT set_config('app.current_school_id',$1,false)", [a.school_id]);
  }, one);
  assert.equal((await one.query('SELECT id FROM users')).rowCount, 0);
});

test('alfa_auth nao extrai tabelas/colunas nem por COPY', async () => {
  for (const sql of [
    'SELECT * FROM users', 'SELECT * FROM schools', 'SELECT password_hash FROM users',
    'SELECT id,school_id,name,email,role,active,deleted_at FROM users',
    'SELECT id,status,deleted_at FROM schools',
    'COPY (SELECT password_hash FROM public.users) TO STDOUT',
    'COPY public.users TO STDOUT',
    'SELECT password_hash FROM users WHERE id=$1'
  ]) await denied(() => authPool.query(sql, sql.includes('$1') ? [a.sub] : []));
  const { rows: [r] } = await authPool.query(`SELECT
    has_any_column_privilege(current_user,'public.users','SELECT') AS users_read,
    has_any_column_privilege(current_user,'public.schools','SELECT') AS schools_read,
    has_any_column_privilege(current_user,'public.audit_logs','SELECT') AS audit_read`);
  assert.deepEqual(r, { users_read: false, schools_read: false, audit_read: false });
});

test('funcoes autenticam bcrypt existente e retornam somente identidade sem hashes', async () => {
  for (const who of [a,b]) {
    for (const [sql, params] of [
      ['SELECT * FROM auth_private.authenticate($1,$2)', [who.email.toUpperCase(), password]],
      ['SELECT * FROM auth_private.resolve_identity($1)', [who.sub]]
    ]) {
      const { rows } = await authPool.query(sql, params);
      assert.equal(rows.length, 1); assert.equal(rows[0].id, who.sub);
      assert.equal(rows[0].school_id, who.school_id);
      assert.deepEqual(Object.keys(rows[0]).sort(), ['active','email','id','name','role','school_id']);
    }
  }
  assert.equal((await authPool.query('SELECT * FROM auth_private.resolve_identity($1)', [randomUUID()])).rowCount, 0);
});

test('senha incorreta, identidade ausente, NULL e limites invalidos falham fechados', async () => {
  for (const [email, pass] of [[a.email,'wrong-password'], ['absent@security.test',password],
    [null,password], [a.email,null], ['',password], [a.email,''],
    ['a'.repeat(151),password], [a.email,'a'.repeat(73)], [a.email,'é'.repeat(37)],
    ["' OR true --",password]]) {
    assert.equal((await authPool.query('SELECT * FROM auth_private.authenticate($1,$2)', [email,pass])).rowCount, 0);
  }
  assert.equal((await login(a, { password: 'wrong-password' })).status, 401);
  assert.equal((await login({ email: 'absent@security.test' })).status, 401);
  assert.equal((await login(a, { password: 'nul\u0000password' })).status, 400);
});

for (const [label, pass] of [['ASCII', 'a'.repeat(72)], ['Unicode', 'á'.repeat(36)]]) {
  test(`bcrypt 2a ${label} com 72 bytes preservado; nao aceita truncamento`, async () => {
    const original = (await admin.query('SELECT password_hash FROM users WHERE id=$1', [a.sub])).rows[0].password_hash;
    const hash = await bcrypt.hash(pass, 12);
    await admin.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash,a.sub]);
    try {
      assert.equal((await login(a, { password: pass })).status, 200);
      assert.equal((await login(a, { password: pass + 'x' })).status, 400);
      assert.equal((await authPool.query('SELECT * FROM auth_private.authenticate($1,$2)', [a.email,pass])).rowCount, 1);
      assert.equal((await authPool.query('SELECT * FROM auth_private.authenticate($1,$2)', [a.email,pass+'x'])).rowCount, 0);
      assert.equal((await authPool.query('SELECT * FROM auth_private.authenticate($1,$2)', [a.email,pass.slice(1)])).rowCount, 0);
    } finally { await admin.query('UPDATE users SET password_hash=$1 WHERE id=$2', [original,a.sub]); }
  });
}

test('hash invalido nao gera vazamento nem autentica identidade', async () => {
  const original = (await admin.query('SELECT password_hash FROM users WHERE id=$1', [a.sub])).rows[0].password_hash;
  await admin.query("UPDATE users SET password_hash='invalid-hash' WHERE id=$1", [a.sub]);
  try {
    const result = await login(a); assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { error: 'Credenciais invalidas' });
  } finally { await admin.query('UPDATE users SET password_hash=$1 WHERE id=$2', [original,a.sub]); }
});

test('owner NOLOGIN restrito; runtime nao assume owner nem altera funcoes', async () => {
  const { rows: [r] } = await admin.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
    rolbypassrls,rolreplication,rolinherit FROM pg_roles WHERE rolname='alfa_auth_owner'`);
  assert.ok(Object.values(r).every(value => value === false));
  for (const p of [pool,authPool]) await denied(() => p.query('SET ROLE alfa_auth_owner'));
  for (const sql of [
    'ALTER FUNCTION auth_private.authenticate(text,text) RESET ALL',
    'ALTER FUNCTION auth_private.resolve_identity(uuid) SECURITY INVOKER',
    'ALTER FUNCTION auth_private.authenticate(text,text) OWNER TO alfa_auth',
    'DROP FUNCTION auth_private.resolve_identity(uuid)',
    'CREATE FUNCTION auth_private.forbidden_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
    "CREATE OR REPLACE FUNCTION auth_private.authenticate(text,text) RETURNS TABLE(id uuid,school_id uuid,name text,email text,role text,active boolean) LANGUAGE sql AS $$ SELECT NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,false $$"
  ]) await denied(() => authPool.query(sql));
  await transaction(async c => {
    await c.query('SET LOCAL ROLE alfa_auth_owner');
    for (const sql of ['UPDATE users SET active=false', 'DELETE FROM schools', 'SELECT * FROM audit_logs',
      'CREATE TABLE public.forbidden_owner_probe(id int)', 'ALTER TABLE users DISABLE ROW LEVEL SECURITY']) {
      await c.query('SAVEPOINT owner_probe');
      await denied(() => c.query(sql));
      await c.query('ROLLBACK TO SAVEPOINT owner_probe');
    }
  });
});

test('EXECUTE negado a alfa_app e PUBLIC, inclusive com USAGE temporario no schema', async () => {
  for (const sql of ["SELECT * FROM auth_private.authenticate('absent@security.test','invalid')",
    'SELECT * FROM auth_private.resolve_identity(NULL::uuid)']) await denied(() => pool.query(sql));
  await transaction(async c => {
    const probe = `auth_probe_${randomUUID().replaceAll('-','')}`;
    await c.query(`CREATE ROLE ${probe} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await c.query(`GRANT USAGE ON SCHEMA auth_private TO ${probe}, alfa_app`);
    for (const role of [probe, 'alfa_app']) {
      await c.query(`SET LOCAL ROLE ${role}`);
      for (const sql of ["SELECT * FROM auth_private.authenticate('absent@security.test','invalid')",
        'SELECT * FROM auth_private.resolve_identity(NULL::uuid)']) {
        await c.query('SAVEPOINT exec_probe');
        await denied(() => c.query(sql));
        await c.query('ROLLBACK TO SAVEPOINT exec_probe');
      }
      await c.query('RESET ROLE');
    }
  });
});

test('search_path hostil e tabelas temporarias nao substituem objetos das funcoes', async () => {
  await transaction(async c => {
    const schema = `auth_shadow_${randomUUID().replaceAll('-','')}`;
    await c.query(`CREATE SCHEMA ${schema}`);
    await c.query(`GRANT USAGE ON SCHEMA ${schema} TO alfa_auth, alfa_auth_owner`);
    await c.query(`CREATE FUNCTION ${schema}.crypt(text,text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'shadow_crypt_called'; END $$`);
    await c.query(`CREATE FUNCTION ${schema}.lower(text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'shadow_lower_called'; END $$`);
    await c.query('CREATE TEMP TABLE users AS SELECT * FROM public.users WHERE id=$1', [a.sub]);
    await c.query('CREATE TEMP TABLE schools AS SELECT * FROM public.schools WHERE id=$1', [a.school_id]);
    await c.query("UPDATE pg_temp.users SET name='SHADOW', role='platform_admin', password_hash=$1", [await bcrypt.hash('shadow-password',12)]);
    await c.query('GRANT SELECT ON pg_temp.users,pg_temp.schools TO alfa_auth_owner');
    await c.query(`SET LOCAL search_path = pg_temp, ${schema}, public`);
    await c.query('SET LOCAL ROLE alfa_auth');
    const result = await c.query('SELECT * FROM auth_private.authenticate($1,$2)', [a.email,password]);
    assert.equal(result.rowCount, 1); assert.equal(result.rows[0].role, 'school_admin');
    assert.notEqual(result.rows[0].name, 'SHADOW');
    assert.equal((await c.query('SELECT * FROM auth_private.authenticate($1,$2)', [a.email,'shadow-password'])).rowCount, 0);
    const identity = (await c.query('SELECT * FROM auth_private.resolve_identity($1)', [a.sub])).rows[0];
    assert.equal(identity.role, 'school_admin'); assert.notEqual(identity.name, 'SHADOW');
  });
});

test('startup rejeita grants de coluna, EXECUTE publico, owner inseguro e search_path alterado', async () => {
  const { assertAuthBoundary } = await import('../../src/config/auth-boundary.js');
  for (const sql of [
    'GRANT SELECT(password_hash) ON users TO alfa_auth',
    'GRANT EXECUTE ON FUNCTION auth_private.authenticate(text,text) TO PUBLIC',
    'ALTER ROLE alfa_auth_owner LOGIN',
    'GRANT alfa_auth_owner TO alfa_auth',
    'ALTER FUNCTION auth_private.authenticate(text,text) RESET search_path'
  ]) await transaction(async c => {
    await c.query(sql);
    await assert.rejects(() => assertAuthBoundary(c), /Fronteira de autenticacao insegura/);
  });
  await assertAuthBoundary(authPool);
});
