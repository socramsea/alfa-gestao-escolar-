import { z } from 'zod';
import { createHash } from 'node:crypto';
import { stages } from './catalog.js';

const code = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).transform(v => v.toUpperCase());
const name = z.string().trim().min(1).max(150).refine(v => !v.includes('\0'));
const stage = z.enum(stages.map(s => s.code));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return v >= '1900-01-01' && v <= '2200-12-31' && !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === v;
});
export const resources = {
  stages: { table: 'school_stages', schema: z.object({ code: stage }).strict() },
  'academic-years': { table: 'academic_years', schema: z.object({ code, starts_on: date, ends_on: date }).strict()
    .refine(v => v.ends_on > v.starts_on) },
  levels: { table: 'school_levels', schema: z.object({ stage_code: stage, code, name }).strict() },
  shifts: { table: 'school_shifts', schema: z.object({ code, name }).strict() },
  'class-groups': { table: 'class_groups', schema: z.object({ code, stage_code: stage,
    academic_year_id: z.string().uuid(), shift_id: z.string().uuid(),
    level_ids: z.array(z.string().uuid()).min(1).max(30).refine(v => new Set(v).size === v.length).transform(v => [...v].sort()) }).strict() }
};
export function fail(statusCode) { const e = new Error('Erro de estrutura escolar'); e.statusCode = statusCode; throw e; }
export function administrator(user) {
  if (!['school_admin','platform_admin'].includes(user.role)) fail(403);
}
export async function list(client, user, resource, page) {
  administrator(user);
  const { table } = resources[resource];
  const extra = resource === 'class-groups' ? `, ARRAY(SELECT l.level_id FROM public.class_group_levels l
    WHERE l.school_id=t.school_id AND l.class_group_id=t.id ORDER BY l.level_id) AS level_ids`
    : resource === 'academic-years' ? ', t.starts_on::text AS starts_on,t.ends_on::text AS ends_on' : '';
  const { rows } = await client.query(`SELECT t.*${extra} FROM public.${table} t
    WHERE t.school_id=$1 ORDER BY t.created_at,t.id LIMIT 101 OFFSET $2`, [user.school_id,(page-1)*100]);
  return { items: rows.slice(0,100), page, has_more: rows.length > 100 };
}
export async function create(client, user, resource, data, key) {
  administrator(user);
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  // Serializa somente reenvios da mesma operação. Constraints protegem duplicatas com chaves diferentes.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [JSON.stringify([user.school_id,user.id,resource,key])]);
  const { rows: [previous] } = await client.query(`SELECT payload_hash,result FROM public.structure_events
    WHERE school_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`, [user.school_id,user.id,resource,key]);
  if (previous) {
    if (previous.payload_hash !== hash) fail(409);
    return { item: previous.result, replayed: true };
  }
  const { table } = resources[resource];
  const { level_ids, ...fields } = data;
  if (resource === 'class-groups') {
    const { rowCount } = await client.query(`SELECT id FROM public.school_levels
      WHERE school_id=$1 AND stage_code=$2 AND id=ANY($3::uuid[])`, [user.school_id,data.stage_code,level_ids]);
    if (rowCount !== level_ids.length) fail(404);
  }
  // Os nomes de campos provêm de objetos Zod strict, não de identificadores fornecidos livremente.
  const columns = Object.keys(fields);
  const { rows: [item] } = await client.query(`INSERT INTO public.${table}(school_id,${columns.join(',')})
    VALUES($1,${columns.map((_,i) => `$${i+2}`).join(',')}) RETURNING *${resource === 'academic-years' ? ',starts_on::text AS starts_on,ends_on::text AS ends_on' : ''}`, [user.school_id,...Object.values(fields)]);
  if (level_ids) {
    for (const id of level_ids) await client.query(`INSERT INTO public.class_group_levels(school_id,class_group_id,level_id,stage_code)
      VALUES($1,$2,$3,$4)`, [user.school_id,item.id,id,item.stage_code]);
    item.level_ids = level_ids;
  }
  await client.query(`INSERT INTO public.structure_events(school_id,user_id,operation,request_key,payload_hash,entity_id,result)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [user.school_id,user.id,resource,key,hash,item.id,JSON.stringify(item)]);
  return { item, replayed: false };
}
