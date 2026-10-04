// Upgrade conservador do banco local do projeto; nunca aponta ao PostgreSQL 5432.
import { mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { runner } from 'node-pg-migrate';
import { administrativeUrl, pool } from '../src/config/admin-db.js';
let backup;
try {
  const url = new URL(administrativeUrl());
  if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '5433' || url.pathname !== '/alfa_gestao') {
    throw new Error('Destino diferente do banco local autorizado');
  }
  const snapshot = async () => {
    const { rows:[row] } = await pool.query(`SELECT jsonb_build_object(
      'schools',(SELECT jsonb_agg(s ORDER BY id) FROM public.schools s),
      'users',(SELECT jsonb_agg(u ORDER BY id) FROM public.users u),
      'audit_logs',(SELECT jsonb_agg(a ORDER BY id) FROM public.audit_logs a)) AS state`);
    return createHash('sha256').update(JSON.stringify(row.state)).digest('hex');
  };
  const before = await snapshot();
  await mkdir('../deploy/backups',{recursive:true,mode:0o700});
  const file = `../deploy/backups/pre-mvp-${Date.now()}.dump`;
  backup = await open(file,'wx',0o600);
  const child = spawn('pg_dump',['-h',url.hostname,'-p',url.port,'-U',decodeURIComponent(url.username),'-d','alfa_gestao','-Fc'],{
    env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)},stdio:['ignore',backup.fd,'pipe'] });
  child.stderr.resume();
  const [code] = await once(child,'exit');
  if (code !== 0) throw new Error('Backup nao concluido; migrations nao executadas');
  await backup.close(); backup = null;
  console.log(`Backup local protegido criado: ${file}`);
  await runner({databaseUrl:administrativeUrl(),dir:'migrations',direction:'up',migrationsTable:'pgmigrations',count:Infinity,
    logger:{info(){},warn(){},error(){}}});
  if (await snapshot() !== before) throw new Error('Divergencia nos registros preexistentes; investigar sem rollback automatico');
  console.log('UPGRADE LOCAL PASS: migrations aplicadas; escolas, usuarios, hashes e auditoria preexistentes preservados.');
} catch(error) { console.error(error.message); process.exitCode=1; }
finally { await backup?.close(); await pool.end(); }
