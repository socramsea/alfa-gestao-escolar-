import { z } from 'zod';
import { createHash } from 'node:crypto';

export const staffTables = ['staff_members','class_group_staff','class_group_staff_endings','staff_events'];
export const roles = ['regente','auxiliar','especialista'];
const text = max => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
const optionalContact = schema => z.preprocess(v => typeof v === 'string' && !v.trim() ? null : v,
  schema.nullable().optional().transform(v => v ?? null));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return v >= '1900-01-01' && v <= '2200-12-31' && !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === v;
});
export const resources = {
  members: { schema: z.object({ full_name: text(150),
    phone: optionalContact(text(30).refine(v => /^[+\d().\s-]+$/.test(v) && /\d/.test(v))),
    email: optionalContact(z.string().trim().email().max(150).transform(v => v.toLowerCase())) }).strict() },
  assignments: { schema: z.object({ staff_member_id: z.string().uuid(), class_group_id: z.string().uuid(),
    role: z.enum(roles), starts_on: date, ends_on: date.nullable().optional().transform(v => v ?? null) }).strict()
    .refine(v => v.ends_on === null || v.ends_on >= v.starts_on) },
  'assignment-endings': { schema: z.object({ assignment_id: z.string().uuid(), ended_on: date }).strict() }
};
export function fail(statusCode) { const e = new Error('Erro de cadastro de profissionais'); e.statusCode = statusCode; throw e; }
function administrator(user) { if (!['school_admin','platform_admin'].includes(user.role)) fail(403); }

// Fim efetivo: encerramento registrado, senão o fim informado, senão o fim do período letivo da turma.
const effectiveEnd = 'COALESCE(x.ended_on,a.ends_on,y.ends_on)';
const queries = {
  members: 'SELECT t.* FROM public.staff_members t WHERE t.school_id=$1',
  assignments: `SELECT a.id,a.school_id,a.staff_member_id,m.full_name AS staff_member_name,a.academic_year_id,y.code AS academic_year_code,
      a.class_group_id,g.code AS class_group_code,a.role,a.starts_on::text AS starts_on,a.ends_on::text AS ends_on,
      x.ended_on::text AS ended_on,${effectiveEnd}::text AS effective_ends_on,a.created_at
    FROM public.class_group_staff a
    JOIN public.staff_members m ON m.school_id=a.school_id AND m.id=a.staff_member_id
    JOIN public.academic_years y ON y.school_id=a.school_id AND y.id=a.academic_year_id
    JOIN public.class_groups g ON g.school_id=a.school_id AND g.id=a.class_group_id AND g.academic_year_id=a.academic_year_id
    LEFT JOIN public.class_group_staff_endings x ON x.school_id=a.school_id AND x.assignment_id=a.id
    WHERE a.school_id=$1`,
  'assignment-endings': `SELECT t.id,t.school_id,t.assignment_id,t.ended_on::text AS ended_on,t.created_at
    FROM public.class_group_staff_endings t WHERE t.school_id=$1`
};
const alias = { members: 't', assignments: 'a', 'assignment-endings': 't' };

export async function list(client,user,resource,page) {
  administrator(user);
  const t = alias[resource];
  const { rows } = await client.query(`${queries[resource]} ORDER BY ${t}.created_at,${t}.id LIMIT 101 OFFSET $2`,
    [user.school_id,(page-1)*100]);
  return { items: rows.slice(0,100), page, has_more: rows.length>100 };
}
async function find(client,user,resource,id) {
  const { rows:[item] } = await client.query(`${queries[resource]} AND ${alias[resource]}.id=$2`,[user.school_id,id]);
  return item;
}
const inserts = {
  async members(client,user,data) {
    const { rows:[item] } = await client.query(`INSERT INTO public.staff_members(school_id,full_name,phone,email)
      VALUES($1,$2,$3,$4) RETURNING id`,[user.school_id,data.full_name,data.phone,data.email]);
    return item.id;
  },
  async assignments(client,user,data) {
    // Serializa atribuições do mesmo profissional na mesma turma para que a checagem de sobreposição seja confiável.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [JSON.stringify(['staff-assignment',user.school_id,data.staff_member_id,data.class_group_id])]);
    // O período letivo deriva do registro da turma, nunca de valor declarado pelo navegador.
    const { rows:[group] } = await client.query(`SELECT g.academic_year_id,y.starts_on::text AS starts_on,y.ends_on::text AS ends_on
      FROM public.class_groups g
      JOIN public.academic_years y ON y.school_id=g.school_id AND y.id=g.academic_year_id
      JOIN public.staff_members m ON m.school_id=g.school_id AND m.id=$2
      WHERE g.school_id=$1 AND g.id=$3`,[user.school_id,data.staff_member_id,data.class_group_id]);
    if (!group) fail(404);
    const end = data.ends_on ?? group.ends_on;
    if (data.starts_on < group.starts_on || end > group.ends_on || data.starts_on > end) fail(400);
    const { rowCount } = await client.query(`SELECT 1 FROM public.class_group_staff a
      JOIN public.academic_years y ON y.school_id=a.school_id AND y.id=a.academic_year_id
      LEFT JOIN public.class_group_staff_endings x ON x.school_id=a.school_id AND x.assignment_id=a.id
      WHERE a.school_id=$1 AND a.staff_member_id=$2 AND a.class_group_id=$3
        AND a.starts_on<=$5::date AND ${effectiveEnd}>=$4::date LIMIT 1`,
    [user.school_id,data.staff_member_id,data.class_group_id,data.starts_on,end]);
    if (rowCount) fail(409);
    const { rows:[item] } = await client.query(`INSERT INTO public.class_group_staff(school_id,staff_member_id,academic_year_id,class_group_id,role,starts_on,ends_on)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [user.school_id,data.staff_member_id,group.academic_year_id,data.class_group_id,data.role,data.starts_on,data.ends_on]);
    return item.id;
  },
  async 'assignment-endings'(client,user,data) {
    const assignment = await find(client,user,'assignments',data.assignment_id);
    if (!assignment) fail(404);
    if (assignment.ended_on) fail(409);
    if (data.ended_on < assignment.starts_on || data.ended_on > assignment.effective_ends_on) fail(400);
    const { rows:[item] } = await client.query(`INSERT INTO public.class_group_staff_endings(school_id,assignment_id,ended_on)
      VALUES($1,$2,$3) RETURNING id`,[user.school_id,data.assignment_id,data.ended_on]);
    return item.id;
  }
};
export async function create(client,user,resource,data,key) {
  administrator(user);
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [JSON.stringify(['staff',user.school_id,user.id,resource,key])]);
  const { rows:[previous] } = await client.query(`SELECT payload_hash,entity_id FROM public.staff_events
    WHERE school_id=$1 AND user_id=$2 AND operation=$3 AND request_key=$4`,[user.school_id,user.id,resource,key]);
  if (previous) {
    if (previous.payload_hash !== hash) fail(409);
    const item = await find(client,user,resource,previous.entity_id);
    if (!item) fail(404);
    return { item, replayed:true };
  }
  const id = await inserts[resource](client,user,data);
  // A auditoria guarda referências e hash, sem duplicar nome ou contatos.
  await client.query(`INSERT INTO public.staff_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[user.school_id,user.id,resource,key,hash,id]);
  return { item: await find(client,user,resource,id), replayed:false };
}
