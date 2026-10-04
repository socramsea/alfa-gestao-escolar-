import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/admin-db.js';
let client;
try {
  const input = z.object({ school: z.string().trim().min(1).max(150),
    name: z.string().trim().min(1).max(150), email: z.string().trim().email().max(150).transform(v=>v.toLowerCase()),
    password: z.string().min(12).refine(v=>Buffer.byteLength(v)<=72 && !v.includes('\0')) }).parse({
      school:process.env.SCHOOL_NAME,name:process.env.ADMIN_NAME || 'Administrador escolar',
      email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD });
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`bootstrap:${input.email}`]);
  const { rows } = await client.query(`SELECT u.id,u.role,u.active,u.deleted_at,s.name,s.status,s.deleted_at AS school_deleted
    FROM public.users u JOIN public.schools s ON s.id=u.school_id WHERE lower(u.email)=$1`,[input.email]);
  if (rows.length > 1) throw new Error('Identidade ambigua');
  const [existing] = rows;
  if (existing) {
    if (existing.name !== input.school || existing.role !== 'school_admin' || !existing.active || existing.deleted_at || existing.school_deleted || !['trial','active'].includes(existing.status)) {
      throw new Error('Conflito de identidade');
    }
    console.log('Escola e administrador já cadastrados; credenciais e dados preservados.');
  } else {
    const { rows:[school] } = await client.query("INSERT INTO public.schools(name,status) VALUES($1,'active') RETURNING id",[input.school]);
    const { rows:[user] } = await client.query(`INSERT INTO public.users(school_id,name,email,password_hash,role)
      VALUES($1,$2,$3,$4,'school_admin') RETURNING id`,[school.id,input.name,input.email,await bcrypt.hash(input.password,12)]);
    await client.query(`INSERT INTO public.audit_logs(school_id,user_id,action,entity_type,entity_id)
      VALUES($1,$2,'bootstrap_school','schools',$1)`,[school.id,user.id]);
    console.log('Escola de teste e administrador criados. Nenhuma senha foi exibida.');
  }
  await client.query('COMMIT');
} catch {
  if (client) await client.query('ROLLBACK');
  console.error('Bootstrap recusado: verifique configuração ou conflito com identidade existente.');
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
