import { z } from 'zod';
import { createHash } from 'node:crypto';

export const peopleTables = ['students','guardians','student_guardians','people_events'];
const text = max => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
const optionalContact = schema => z.preprocess(v => typeof v === 'string' && !v.trim() ? null : v,
  schema.nullable().optional().transform(v => v ?? null));
const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date = new Date(`${v}T00:00:00Z`);
  return v >= '1900-01-01' && v <= new Date().toISOString().slice(0,10)
    && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === v;
});
export const resources = {
  students: { table: 'students', schema: z.object({ full_name: text(150), birth_date: birthDate }).strict() },
  guardians: { table: 'guardians', schema: z.object({ full_name: text(150),
    phone: optionalContact(text(30).refine(v => /^[+\d().\s-]+$/.test(v) && /\d/.test(v))),
    email: optionalContact(z.string().trim().email().max(150).transform(v => v.toLowerCase())) }).strict() },
  'student-guardians': { table: 'student_guardians', schema: z.object({
    student_id: z.string().uuid(), guardian_id: z.string().uuid(),
    relationship: text(80), is_legal: z.boolean() }).strict() }
};
export function fail(statusCode) { const e = new Error('Erro de cadastro de pessoas'); e.statusCode = statusCode; throw e; }
function administrator(user) { if (!['school_admin','platform_admin'].includes(user.role)) fail(403); }
function projection(resource) { return resource === 'students' ? 't.*,t.birth_date::text AS birth_date' : 't.*'; }

export async function list(client,user,resource,page) {
  administrator(user);
  const { rows } = await client.query(`SELECT ${projection(resource)} FROM public.${resources[resource].table} t
    WHERE t.school_id=$1 ORDER BY t.created_at,t.id LIMIT 101 OFFSET $2`,[user.school_id,(page-1)*100]);
  return { items: rows.slice(0,100), page, has_more: rows.length>100 };
}
export async function create(client,user,resource,data,key) {
  administrator(user);
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [JSON.stringify(['people',user.school_id,user.id,resource,key])]);
  const { rows:[previous] } = await client.query(`SELECT payload_hash,entity_id FROM public.people_events
    WHERE school_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`,[user.school_id,user.id,resource,key]);
  if (previous) {
    if (previous.payload_hash !== hash) fail(409);
    const { rows:[item] } = await client.query(`SELECT ${projection(resource)} FROM public.${resources[resource].table} t
      WHERE t.school_id=$1 AND t.id=$2`,[user.school_id,previous.entity_id]);
    if (!item) fail(404);
    return { item, replayed:true };
  }
  if (resource === 'student-guardians') {
    for (const [table,id] of [['students',data.student_id],['guardians',data.guardian_id]]) {
      const { rowCount } = await client.query(`SELECT id FROM public.${table} WHERE school_id=$1 AND id=$2`,[user.school_id,id]);
      if (rowCount !== 1) fail(404);
    }
  }
  // Identificadores vêm exclusivamente do schema Zod strict da rota.
  const columns = Object.keys(data);
  const { rows:[item] } = await client.query(`INSERT INTO public.${resources[resource].table}(school_id,${columns.join(',')})
    VALUES($1,${columns.map((_,i)=>`$${i+2}`).join(',')}) RETURNING *${resource === 'students' ? ',birth_date::text AS birth_date' : ''}`,
  [user.school_id,...Object.values(data)]);
  // A auditoria guarda referências e hash, sem duplicar nome, nascimento ou contatos.
  await client.query(`INSERT INTO public.people_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[user.school_id,user.id,resource,key,hash,item.id]);
  return { item, replayed:false };
}
