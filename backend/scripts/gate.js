import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { structureTables } from '../src/modules/structure/catalog.js';

// Reconstroi em container novo, tmpfs, sem montar/remover volumes persistentes.
const name = `alfa-gate-${Date.now()}`;
const secret = () => randomBytes(32).toString('hex');
const adminPassword = secret();
const dockerEnv = { ...process.env, POSTGRES_PASSWORD: adminPassword };
let started = false, api, preview, admin;
function docker(args) {
  const p = spawnSync('docker', args, { encoding: 'utf8', env: dockerEnv });
  if (p.status !== 0) throw new Error(`Docker ${args[0]} falhou: ${p.stderr?.trim()}`);
  return p.stdout.trim();
}
async function command(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Comando ${args[0]} terminou com codigo ${code}`);
}
try {
  docker(['run', '-d', '--rm', '--name', name, '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=alfa_gestao',
    '-p', '127.0.0.1::5432', 'postgres:15']);
  started = true;
  const mapping = docker(['port', name, '5432/tcp']);
  const port = mapping.match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port || port === '5432' || port === '5433') throw new Error('Porta isolada invalida');
  const adminUrl = `postgresql://postgres:${adminPassword}@127.0.0.1:${port}/alfa_gestao`;
  admin = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await admin.query('SELECT 1'); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error('PostgreSQL isolado nao iniciou');
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const apiPort = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort),
    ADMIN_DATABASE_URL: adminUrl,
    DATABASE_URL: `postgresql://alfa_app:${secret()}@127.0.0.1:${port}/alfa_gestao`,
    AUTH_DATABASE_URL: `postgresql://alfa_auth:${secret()}@127.0.0.1:${port}/alfa_gestao`,
    JWT_SECRET: secret(), ADMIN_EMAIL: 'admin@alfareis.test', ADMIN_PASSWORD: secret(),
    CORS_ORIGINS: 'http://localhost:5173', TEST_ALLOW_MUTATION: 'fictional-fixtures',
    // A suíte faz dezenas de envios públicos; o limite real é coberto por teste próprio.
    PUBLIC_LEADS_PER_WINDOW: '1000',
    TEST_BASE_URL: `http://127.0.0.1:${apiPort}` };
  console.log('GATE: PostgreSQL Docker limpo em porta isolada; dados ficticios; armazenamento tmpfs.');
  const migrationOptions = { databaseUrl: adminUrl, dir: 'migrations', direction: 'up', migrationsTable: 'pgmigrations',
    logger: { info() {}, warn() {}, error() {} } };
  await runner({ ...migrationOptions, count: 1 });
  // Prova executavel de preflight: duplicatas nao podem ser escolhidas/corrigidas silenciosamente.
  const { rows: [s] } = await admin.query("INSERT INTO schools(name) VALUES('Duplicate preflight fixture') RETURNING id");
  await admin.query("INSERT INTO users(school_id,name,email,password_hash,role) VALUES($1,'duplicate','Duplicate@security.test','dummy','teacher'),($1,'duplicate','duplicate@security.test','dummy','teacher')", [s.id]);
  let duplicateBlocked = false;
  try { await runner({ ...migrationOptions, count: Infinity }); }
  catch (error) { duplicateBlocked = /FASE0_DUPLICATE_LOGIN_EMAIL/.test(error.message); }
  if (!duplicateBlocked) throw new Error('Migration nao rejeitou duplicatas explicitamente');
  const { rows: [count] } = await admin.query('SELECT count(*)::int AS n FROM users WHERE school_id=$1', [s.id]);
  if (count.n !== 2) throw new Error('Preflight alterou dados');
  console.log('PASS: migration rejeita duplicatas case-insensitive sem modificar dados.');
  await admin.query('DELETE FROM users WHERE school_id=$1', [s.id]);
  await admin.query('DELETE FROM schools WHERE id=$1', [s.id]);
  // Upgrade real: cria identidades bcrypt sob a 002 antes de aplicar a 003.
  await runner({ ...migrationOptions, count: 1 });
  await command(['scripts/provision-passwords.js'], env);
  for (const file of ['src/database/seed-admin.js','src/database/seed-tenant-b.js']) await command([file], env);
  async function snapshot() {
    return JSON.stringify((await admin.query(`SELECT jsonb_build_object(
      'schools',(SELECT jsonb_agg(s ORDER BY id) FROM schools s),
      'users',(SELECT jsonb_agg(u ORDER BY id) FROM users u)) AS state`)).rows[0].state);
  }
  const original = await snapshot();
  const { rows: [probe] } = await admin.query(`INSERT INTO users(school_id,name,email,password_hash,role)
    SELECT id,'Unsupported hash fixture','unsupported-hash@security.test','unsupported','teacher'
    FROM schools ORDER BY id LIMIT 1 RETURNING id`);
  let unsupportedBlocked = false;
  try { await runner({ ...migrationOptions, count: Infinity }); }
  catch (error) { unsupportedBlocked = /FASE0_UNSUPPORTED_PASSWORD_HASH/.test(error.message); }
  if (!unsupportedBlocked) throw new Error('Migration 003 nao rejeitou hash incompativel');
  if ((await admin.query('SELECT id FROM users WHERE id=$1', [probe.id])).rowCount !== 1) {
    throw new Error('Preflight 003 alterou a identidade incompativel');
  }
  await admin.query('DELETE FROM users WHERE id=$1', [probe.id]);
  // Prova de upgrade 004 -> 005 com estrutura preexistente, antes da nova API.
  await runner({ ...migrationOptions, count: 2 });
  const { rows: [actor] } = await admin.query('SELECT id,school_id FROM users ORDER BY id LIMIT 1');
  const schoolId = actor.school_id;
  await admin.query("INSERT INTO school_stages(school_id,code) VALUES($1,'infantil')",[schoolId]);
  const { rows:[year] } = await admin.query("INSERT INTO academic_years(school_id,code,starts_on,ends_on) VALUES($1,'UPGRADE','2027-01-01','2027-12-31') RETURNING id",[schoolId]);
  const { rows:[shift] } = await admin.query("INSERT INTO school_shifts(school_id,code,name) VALUES($1,'UPGRADE','Upgrade') RETURNING id",[schoolId]);
  const { rows:[level] } = await admin.query("INSERT INTO school_levels(school_id,stage_code,code,name) VALUES($1,'infantil','UPGRADE','Upgrade') RETURNING id",[schoolId]);
  const { rows:[group] } = await admin.query("INSERT INTO class_groups(school_id,academic_year_id,shift_id,stage_code,code) VALUES($1,$2,$3,'infantil','UPGRADE') RETURNING id",[schoolId,year.id,shift.id]);
  await admin.query("INSERT INTO class_group_levels(school_id,class_group_id,level_id,stage_code) VALUES($1,$2,$3,'infantil')",[schoolId,group.id,level.id]);
  await admin.query("INSERT INTO structure_events(school_id,user_id,operation,request_key,payload_hash,entity_id,result) VALUES($1,$2,'class-groups',gen_random_uuid(),'upgrade',$3,'{}')",[schoolId,actor.id,group.id]);
  async function structureSnapshot() {
    const snapshot = [];
    for (const table of structureTables) snapshot.push((await admin.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows);
    return JSON.stringify(snapshot);
  }
  const existingStructure = await structureSnapshot();
  await command(['scripts/migrate.js'], env);
  await command(['scripts/migrate.js'], env);
  if (await structureSnapshot() !== existingStructure) throw new Error('Migration de pessoas alterou estrutura existente');
  for (const table of ['structure_events','class_group_levels','class_groups','school_levels','school_shifts','academic_years','school_stages']) {
    await admin.query(`DELETE FROM public.${table} WHERE school_id=$1`,[schoolId]);
  }
  console.log('PASS: upgrade 004 -> 005 preserva estrutura existente; migrations repetidas sem alteracao.');
  if (await snapshot() !== original) throw new Error('Migration 003 alterou usuarios/escolas/hashes');
  console.log('PASS: migration 003 rejeita formato incompativel e preserva hashes/identidades bcrypt existentes.');
  for (const file of ['src/database/seed-admin.js','src/database/seed-tenant-b.js']) await command([file], env);
  if (await snapshot() !== original) throw new Error('Seeds nao idempotentes');
  console.log('PASS: ambos os seeds idempotentes, incluindo UUIDs, hashes e timestamps.');
  api = spawn(process.execPath, ['src/server.js'], { env, stdio: 'inherit' });
  ready = false;
  for (let i = 0; i < 60; i++) {
    if (api.exitCode !== null) throw new Error('API encerrou na inicializacao');
    try { if ((await fetch(`${env.TEST_BASE_URL}/api/health`)).ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) throw new Error('API isolada nao iniciou');
  await command(['--test', '--test-concurrency=1'], env);
  await command(['scripts/check-syntax.js'], env);
  if (process.env.GATE_BROWSER === '1') {
    const webListener = createServer(); webListener.listen(0, '127.0.0.1'); await once(webListener,'listening');
    const webPort = webListener.address().port;
    await new Promise(resolve => webListener.close(resolve));
    const browserEnv = { ...env, ALFA_TEST_API_TARGET: env.TEST_BASE_URL,
      E2E_BASE_URL: `http://127.0.0.1:${webPort}`, E2E_EMAIL: env.ADMIN_EMAIL,
      E2E_PASSWORD: env.ADMIN_PASSWORD, E2E_SCREENSHOT: '/tmp/alfa-mvp-mobile.png',
      E2E_BROWSER_EXECUTABLE: process.env.E2E_BROWSER_EXECUTABLE || '/usr/bin/google-chrome' };
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(webPort),'--strictPort'],
      { cwd: '../frontend', env: browserEnv, stdio: 'inherit' });
    let webReady = false;
    for (let i=0; i<60; i++) {
      if (preview.exitCode !== null) throw new Error('Preview encerrou');
      try { if ((await fetch(browserEnv.E2E_BASE_URL)).ok) { webReady=true; break; } } catch {}
      await delay(250);
    }
    if (!webReady) throw new Error('Preview indisponivel');
    await command(['../frontend/node_modules/@playwright/test/cli.js','test','--config','../frontend/playwright.config.js'],browserEnv);
    console.log('BROWSER LOCAL PASS: frontend build + API + PostgreSQL isolado; nao certifica runtime Docker de deploy.');
  }
  console.log('GATE CLEAN REBUILD PASS: migrations, preflight, seeds, API, suite completa e sintaxe.');
} catch (error) {
  console.error('GATE CLEAN REBUILD BLOCKED:', error.message);
  process.exitCode = 1;
} finally {
  if (preview && preview.exitCode === null) { const done = once(preview,'exit'); preview.kill('SIGTERM'); await done; }
  if (api && api.exitCode === null) { const done = once(api, 'exit'); api.kill('SIGTERM'); await done; }
  if (admin) await admin.end();
  if (started) docker(['stop', name]);
}
