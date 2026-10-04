import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pool, administrativeUrl } from '../src/config/admin-db.js';
const target = new URL(administrativeUrl());
if (!['localhost','127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/alfa_gestao') {
  throw new Error('Verificacao local exige Docker oficial localhost:5433/alfa_gestao');
}
const env = { ...process.env, TEST_ALLOW_MUTATION: 'fictional-fixtures',
  TEST_BASE_URL: 'http://127.0.0.1:4000' };
async function run(args) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Verificacao falhou: ${args[0]} (exit ${code})`);
}
async function snapshot() {
  return JSON.stringify((await pool.query(`SELECT jsonb_build_object(
    'schools',(SELECT jsonb_agg(s ORDER BY id) FROM schools s),
    'users',(SELECT jsonb_agg(u ORDER BY id) FROM users u)) AS state`)).rows[0].state);
}
try {
  for (const file of ['src/database/seed-admin.js','src/database/seed-tenant-b.js']) await run([file]);
  const original = await snapshot();
  for (const file of ['src/database/seed-admin.js','src/database/seed-tenant-b.js']) await run([file]);
  if (await snapshot() !== original) throw new Error('Seeds locais nao idempotentes');
  console.log('PASS: seeds idempotentes no Docker oficial.');
  await run(['--test','--test-concurrency=1']);
  if (await snapshot() !== original) throw new Error('Suite modificou registros fora das fixtures');
  console.log('PASS: suite oficial concluida e fixtures removidas; registros preexistentes preservados.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
