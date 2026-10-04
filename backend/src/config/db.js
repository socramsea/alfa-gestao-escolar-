import pg from 'pg';
import 'dotenv/config';
import { assertAuthBoundary } from './auth-boundary.js';
import { structureTables } from '../modules/structure/catalog.js';
import { peopleTables } from '../modules/people/service.js';
import { enrollmentTables } from '../modules/enrollments/service.js';
import { staffTables } from '../modules/staff/service.js';
import { admissionTables } from '../modules/admissions/service.js';
import { assertSiteBoundary } from './site-boundary.js';

function connection(variable, role) {
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} obrigatoria`);
  const url = new URL(value);
  if (decodeURIComponent(url.username) !== role) throw new Error(`${variable} deve usar ${role}`);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (!url.port || url.port === '5432')) {
    throw new Error('Runtime bloqueado na porta local 5432');
  }
  return value;
}
export const pool = new pg.Pool({ connectionString: connection('DATABASE_URL', 'alfa_app'), application_name: 'alfa-runtime',
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
export const authPool = new pg.Pool({ connectionString: connection('AUTH_DATABASE_URL', 'alfa_auth'), application_name: 'alfa-authentication',
  max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
for (const p of [pool, authPool]) p.on('error', () => console.error('Falha em conexao ociosa do banco'));

export async function testDatabaseConnection() {
  for (const [p, expected] of [[pool, 'alfa_app'], [authPool, 'alfa_auth']]) {
    const { rows: [r] } = await p.query(`SELECT current_user AS name, rolsuper, rolbypassrls,
      rolcreatedb, rolcreaterole, rolreplication, rolinherit,
      EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid) AS membership,
      EXISTS (SELECT 1 FROM pg_class WHERE relowner = pg_roles.oid) AS owns_objects
      FROM pg_roles WHERE rolname = current_user`);
    if (r.name !== expected || Object.entries(r).some(([k, v]) => k !== 'name' && v)) {
      throw new Error('Identidade PostgreSQL insegura');
    }
    const { rows } = await p.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [['schools','users','audit_logs',...structureTables,...peopleTables,...enrollmentTables,...staffTables,...admissionTables]]);
    if (rows.length !== 3 + structureTables.length + peopleTables.length + enrollmentTables.length + staffTables.length + admissionTables.length || rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity)) {
      throw new Error('RLS obrigatorio ausente');
    }
  }
  await assertAuthBoundary(authPool);
  await assertSiteBoundary(pool);
  console.log('Banco validado: roles restritas, RLS/FORCE ativos, alfa_auth sem leitura direta de tabelas e site publico somente por funcoes.');
}
